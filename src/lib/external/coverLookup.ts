// ISBN から書影を引く順番 (設計は docs/19-書影取得計画.md §2)。
// サーバ側で動く (/api/books/[isbn] から呼ばれる)。
//
//   openBD cover … 書誌の応答に URL が入っている (追加の API リクエストが要らない)。
//                  当たるのはホワイトリスト版元だけ (実測 1/11) だが、
//                  明文の利用条件があるタダの書影はこれしかない
//   楽天ブックス   … applicationId が要る代わりに実際に当たる
//
// **書誌が本体、書影はおまけ**。この順位を崩さないため、ここは何があっても
// throw しない (bookLookup とわざと違う)。書影が載らないだけで、書名・著者は
// 今までどおり入る。

import { normalizeImage } from '../images/normalizeImage'
import { fetchCoverUrl as fetchRakutenCoverUrl } from './rakutenBooks'
import { withSourceTimeout } from './sourceTimeout'
import { MAX_IMAGE_BYTES } from '../uploads/limits'
import { sniffImageFormat } from '../uploads/sniff/image'

export interface CoverImage {
  // 保存 (imageStore) にそのまま渡せる形で持つ
  bytes: Uint8Array<ArrayBuffer>
  mime: string
  ext: string
}

// 書影を取りに行ってよいホスト。
//
// openBD の cover も楽天の largeImageUrl も**外部 API の応答に書かれた URL**
// で、そのまま fetch すると、応答が壊れた・乗っ取られたときにこのサーバが
// 任意の URL を叩く踏み台になる (SSRF)。ホストを名指しで縛る。
const ALLOWED_HOSTS = ['cover.openbd.jp']
// 楽天の画像はリクエストのたびに配信ホストが変わりうる (@0_mall のドメインが
// 複数ある) ため、楽天が持つドメインの配下だけを許す。先頭の "." が要る:
// 無いと evil-rakuten.co.jp が通ってしまう
const ALLOWED_HOST_SUFFIXES = ['.rakuten.co.jp', '.r10s.jp']

export function isAllowedCoverUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false // URL として読めない
  }
  if (parsed.protocol !== 'https:') {
    return false
  }
  const host = parsed.hostname
  return (
    ALLOWED_HOSTS.includes(host) ||
    ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  )
}

// 応答の本文を、上限を超えた時点で打ち切りながら読む。超えたら null。
//
// **Content-Length は防御にならない**。ヘッダが無い応答 (chunked) では
// 何も分からず、値は送り手の申告でしかない。それでいて arrayBuffer() は
// 申告と無関係に本文を最後までメモリに読み切るため、「読み切ってから
// 大きさを見る」形にすると上限を宣言している意味がない。
// 読みながら数えて、超えた時点で受信をやめる。
async function readWithLimit(
  res: Response,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = res.body?.getReader()
  if (!reader) {
    return null // 本文が無い
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    total += value.byteLength
    if (total > max) {
      await reader.cancel() // これ以上受け取らない
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

// 書影を 1 つ取ってくる。書影として扱えないものはすべて null (書影なし)。
//
// 「200 が返った」を鵜呑みにしない。書影 API は「無い」を素直に 404 で返すとは
// 限らず、404 + プレースホルダ画像を返す口もある (docs/19 §3)。
// ステータス・Content-Type・**中身の先頭バイト**の 3 つが揃ったものだけ通す。
async function downloadCover(
  url: string,
  signal?: AbortSignal,
): Promise<CoverImage | null> {
  // リダイレクトは追わない。許可リストを通した URL が別ホストへ
  // 飛ばされたら縛った意味がなくなる
  const res = await fetch(url, { signal, redirect: 'error' })
  if (res.status === 404) {
    return null // 収録なし。エラーではない
  }
  if (!res.ok) {
    // 403・429・5xx は「書影が無い」のではなく**訊けていない**。null に混ぜると
    // 塞がれた・落ちたことに誰も気づけないまま、書影が出ない状態が続く
    // (NDL の書影 API は終了後、自サイト以外に 403 を返すようになった)。
    // throw すれば lookupCover が警告に残して次の取得元を試す
    throw new Error(`書影が HTTP ${res.status} で返りました`)
  }

  // メモリ枯渇対策: 申告が大きすぎるなら読む前に諦める。
  // ただしこれは早く諦めるためだけのもので、防御はこの下の readWithLimit が持つ
  if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) {
    return null
  }

  const bytes = await readWithLimit(res, MAX_IMAGE_BYTES)
  if (!bytes) {
    return null // 上限超過。書影として扱わない
  }

  // 申告された Content-Type を信用せず、実際の中身から形式を決める
  // (アップロード経路と同じ検査。サーバが取ってきた画像でも水準を下げない)。
  // 書影 API は jpg/png しか返さないので、要変換の HEIC/TIFF や非対応は捨てる
  // — 書影のためだけに変換器 (heic-decode/sharp) を呼びたくない
  const format = sniffImageFormat(bytes)
  if (!format || format === 'heic' || format === 'tiff') {
    return null // 非対応・要変換の形式は書影に使わない (SVG や HTML のエラーページも)
  }
  // 無変換形式なので normalizeImage はバイト列をそのまま返し、mime/ext だけ
  // アップロード経路と同一の規則で決まる (対応表を二重に持たない)
  const { mime, ext } = await normalizeImage(bytes, format)
  return { bytes, mime, ext }
}

// 書影の取得元。openBD の URL は書誌のついでに得ているので引数で受け取る
// (書誌のためにもう一度 openBD を叩かない)。
type CoverSource = {
  name: string
  coverUrl: (signal?: AbortSignal) => Promise<string | null>
}

// 見つかった最初の書影を返す。どこにも無ければ null。
//
// openBdCoverUrl は書誌 (BookSummary.coverUrl) から渡す。NDL から書誌が来た
// ときや、openBD が書影を持たないときは undefined で、その場合は楽天だけを引く。
export async function lookupCover(
  isbn: string,
  openBdCoverUrl?: string,
  signal?: AbortSignal,
): Promise<CoverImage | null> {
  const sources: CoverSource[] = [
    { name: 'openBD', coverUrl: async () => openBdCoverUrl ?? null },
    { name: '楽天ブックス', coverUrl: (s) => fetchRakutenCoverUrl(isbn, s) },
  ]

  for (const source of sources) {
    if (signal?.aborted) {
      return null // 呼び出しが打ち切られた。次を叩かない
    }
    try {
      // 1 つの API が黙り込んでも次を試せるよう、取得ごとに上限を持つ
      const url = await withSourceTimeout(signal, (s) => source.coverUrl(s))
      if (!url) {
        continue // この API に書影が無かった。警告も出さず次へ
      }
      if (!isAllowedCoverUrl(url)) {
        console.warn(`${source.name} の書影 URL が許可外のため取得しません (isbn=${isbn})`, url)
        continue
      }
      const cover = await withSourceTimeout(signal, (s) => downloadCover(url, s))
      if (cover) {
        return cover
      }
    } catch (err) {
      if (signal?.aborted) {
        return null // 中断。想定内なので警告も出さない
      }
      // 握り潰さずに残したうえで次を試す。書影が無くても書誌は返す
      console.warn(`${source.name} から書影を取得できませんでした (isbn=${isbn})`, err)
    }
  }
  return null
}
