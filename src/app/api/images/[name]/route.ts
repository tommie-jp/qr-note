import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isPublicImageName } from '@/lib/items/read'
import {
  byteHeaders,
  bytesResponse,
  partialBytesResponse,
  unsatisfiableRangeResponse,
  withAcceptRanges,
} from '@/lib/route/bytes'
import { resolveByteRange } from '@/lib/route/httpRange'
import { apiFail } from '@/lib/route/respond'
import { currentUser } from '@/lib/auth/session'
import { THUMB_MIME } from '@/lib/images/thumbConfig'
import { isAllowedContentMime, isValidAttachmentName, isValidVideoName } from '@/lib/uploads/names'

interface RouteContext {
  params: Promise<{ name: string }>
}

// ファイル名が UUID で内容が変わらないため長期キャッシュしてよい。
//
// private なのは、共有キャッシュ (プロキシ) に置かせないため。以前は
// public だったが、非公開の画像にそれが付いているのは元から筋が悪く、
// 未ログインでも取れる口ができた以上そのままにはしない。ブラウザの
// キャッシュは private でも効くので、失うものはない (docs/22 §6)。
//
// 承知の穴: 一度公開した画像は閲覧者のブラウザに 1 年残る。非公開へ
// 戻しても既に見た人の手元からは消えない
const IMMUTABLE_CACHE = 'private, max-age=31536000, immutable'

// サムネを求められたが未生成で原寸を返すときのキャッシュ。
//
// **immutable にしてはいけない**。バックフィル前や生成に失敗した画像では
// ?thumb=1 が原寸を返すが、それを 1 年 immutable で焼くと、後からサムネが
// 出来ても閲覧者のブラウザは数 MB の原寸を掴んだままになる。短く持たせて
// おけば、バックフィル後の再訪でサムネへ入れ替わる
const FALLBACK_CACHE = 'private, max-age=60'

// アップロード済み画像の配信。ファイル名は UUID + 拡張子のみ許可し、
// それ以外 (トラバーサル等) は 400 で弾く。
// ?thumb=1 は一覧用の縮小版 (src/lib/images/thumbnail.ts)。
export async function GET(
  request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { name } = await params
  const search = new URL(request.url).searchParams
  const wantThumb = search.get('thumb') === '1'
  // 動画の「動くサムネ」(docs/72-動画アニメサムネ計画.md)。静止サムネと同じ
  // ?thumb=1 の口に相乗りするが、返すのは別の列 (thumb_anim)
  const wantAnim = wantThumb && search.get('anim') === '1'

  // 名前の検算が先。この後の isPublicImageName は名前を SQL の
  // position() へ渡すので、書式を確かめてから渡す。
  // 画像・音声のどちらの保存名も許す (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)
  if (!isValidAttachmentName(name)) {
    return apiFail('不正なファイル名です', 400)
  }

  // 画像はメモの中身そのもの (メモに貼った写真) なので、ノート本文と同じく守る。
  // 名前は UUID で当てられないが、当てにくさは認証の代わりにならない。
  //
  // ただし公開ノートに貼った画像は配る (docs/22-ノート公開計画.md §6)。
  // ここを閉じたままだと、公開ノートを開いた人には本文だけ出て画像が割れる
  // = 公開が半分しか効かない。
  //
  // proxy.ts はこの口を未ログインでも素通しする (isSelfGuardedPath)。
  // 素通しした以上、判定はここが唯一の砦になる
  if (!(await canView(name))) {
    return apiFail('ログインが必要です', 401)
  }

  // 動くサムネ。**代替を一切しない**のが要点 — 無ければ 404 を返し、表示側は
  // それを「静止サムネのままでよい」の合図として使う (components/video/useAnimThumb.ts)。
  // 静止サムネで代替すると、表示側は差し替えが効いたのか効かなかったのかを
  // 見分けられず、生成されていない動画に何度も要求を出し続けることになる
  if (wantAnim) {
    const row = await prisma.image.findUnique({
      where: { name },
      select: { thumbAnim: true },
    })
    if (row?.thumbAnim) {
      return bytesResponse(row.thumbAnim, attachmentHeaders(THUMB_MIME, IMMUTABLE_CACHE))
    }
    return apiFail('動くサムネイルがありません', 404, { cacheControl: FALLBACK_CACHE })
  }

  // サムネだけを引く。原寸 (data) は数 MB ありうるので、一覧の 20 枚分を
  // 読んでから捨てることのないよう列を分けて取る
  if (wantThumb) {
    const row = await prisma.image.findUnique({
      where: { name },
      select: { thumb: true },
    })
    if (row?.thumb) {
      return bytesResponse(row.thumb, attachmentHeaders(THUMB_MIME, IMMUTABLE_CACHE))
    }
    // 動画はサムネが無くても**原寸で代替しない**。poster が無いだけで数十 MB の
    // 動画本体を返してしまうと、一覧や <video poster> の意図に反する。404 を返せば
    // ブラウザは poster を静かに無視する (41-QR-search/docs/14 §Phase4)。行が無い場合も 404。
    if (isValidVideoName(name)) {
      return apiFail('サムネイルがありません', 404, { cacheControl: FALLBACK_CACHE })
    }
    // 画像は未生成 (バックフィル前・生成失敗) なら原寸で代替する。一覧は重くなるが
    // 絵は出る。行そのものが無い場合もここを抜け、下の 404 に合流する
  }

  const cacheControl = wantThumb ? FALLBACK_CACHE : IMMUTABLE_CACHE

  // 原寸は Range に応える (音声・動画のシーク)。**全体を読まずに DB で切り出す**
  // (2026-11 の監査 M-11)。動画の再生は Range を何度も飛ばし、公開ノートの 30MB
  // なら未ログインでも 1 要求ごとに全行 + 複製の 60MB を使わせられた
  const ranged = await servePartial(request.headers.get('range'), name, cacheControl)
  if (ranged !== null) {
    return ranged
  }

  const image = await prisma.image.findUnique({
    where: { name },
    select: { mime: true, data: true },
  })

  if (!image) {
    return apiFail('画像が見つかりません', 404)
  }

  return new NextResponse(new Uint8Array(image.data), {
    headers: withAcceptRanges(attachmentHeaders(contentTypeOf(image.mime), cacheControl)),
  })
}

// HEAD: 長さとヘッダだけ。Next は HEAD を GET に倒して本文を捨てるが、それだと
// 数十 MB の行を読んでから捨てることになる (監査 M-11)
export async function HEAD(request: Request, { params }: RouteContext): Promise<NextResponse> {
  const { name } = await params
  if (!isValidAttachmentName(name)) {
    return apiFail('不正なファイル名です', 400)
  }
  if (!(await canView(name))) {
    return apiFail('ログインが必要です', 401)
  }
  const located = await locate(name)
  if (located === null) {
    return apiFail('画像が見つかりません', 404)
  }
  return new NextResponse(null, {
    headers: {
      ...withAcceptRanges(attachmentHeaders(contentTypeOf(located.mime), IMMUTABLE_CACHE)),
      'Content-Length': String(located.size),
    },
  })
}

// 保存時に検証済みだが、DB の値をそのまま信用せず既知の MIME のときだけ採用する
function contentTypeOf(mime: string): string {
  return isAllowedContentMime(mime) ? mime : 'application/octet-stream'
}

interface Located {
  readonly mime: string
  readonly size: number
}

// 行の mime と長さだけ (data は読まない)。無ければ null
async function locate(name: string): Promise<Located | null> {
  const rows = await prisma.$queryRaw<{ mime: string; size: number }[]>`
    SELECT mime, octet_length(data)::int AS size FROM images WHERE name = ${name}
  `
  return rows[0] ?? null
}

// Range 要求に、必要な範囲だけ DB から切り出して応える。
//   null … Range が無い / 読めない形 → 呼び手が全体を 200 で返す
async function servePartial(
  rangeHeader: string | null,
  name: string,
  cacheControl: string,
): Promise<NextResponse | null> {
  if (rangeHeader === null) {
    return null
  }
  const located = await locate(name)
  if (located === null) {
    return apiFail('画像が見つかりません', 404)
  }
  const headers = attachmentHeaders(contentTypeOf(located.mime), cacheControl)
  const range = resolveByteRange(rangeHeader, located.size)
  if (range === null) {
    return null
  }
  if (range === 'unsatisfiable') {
    return unsatisfiableRangeResponse(located.size, headers)
  }
  // substring は 1 始まり。int に寄せるのは、パラメータが数値のままだと
  // double precision と解釈されて substring(bytea, double) が無いと言われるため
  const length = range.end - range.start + 1
  const rows = await prisma.$queryRaw<{ chunk: Uint8Array }[]>`
    SELECT substring(data from ${range.start + 1}::int for ${length}::int) AS chunk
    FROM images WHERE name = ${name}
  `
  return partialBytesResponse(rows[0]?.chunk ?? new Uint8Array(0), range, located.size, headers)
}

// 画像・音声・PDF をクローラーのインデックスから外す
// (docs/90-クローラ対策計画.md §2)。
//
// **HTML の noindex では届かない。** /item のページ metadata は
// `robots: { index: false }` を出しているが、あれはその HTML の話で、
// 画像そのものは別の URL として取得される。バイト列に meta タグは書けないので、
// 画像に「載せるな」を伝える口はレスポンスヘッダしかない。
//
// 公開ノートに貼った添付は未ログインでも配る (docs/22-ノート公開計画.md §6)
// = クローラーの手が届く、というのがここの前提。ログイン中の配信にも付くが、
// クローラーはログインしないので害はない。
function attachmentHeaders(contentType: string, cacheControl: string): Record<string, string> {
  return byteHeaders({ contentType, cacheControl, noindex: true })
}

// 配ってよい画像か。ログイン中なら全部、未ログインなら公開ノートに
// 貼られているものだけ。
//
// ログイン検査を先に置く (uploads/request.ts と同じ流儀)。持ち主の閲覧で毎回
// items を走査しないため。
//
// 未ログインは**行の有無を主キーで先に見る** (2026-11 の監査 M-10)。書式さえ合えば
// 存在しない名前でも isPublicImageName が items 全件の position() を流していたので、
// ランダムな UUID の連打で DB を未ログインに削られた。無い名前の応答は非公開と
// 同じ 401 にして、存在の有無を教えない
async function canView(name: string): Promise<boolean> {
  if ((await currentUser()) !== null) {
    return true
  }
  const exists = await prisma.image.findUnique({ where: { name }, select: { name: true } })
  if (exists === null) {
    return false
  }
  return isPublicImageName(name)
}
