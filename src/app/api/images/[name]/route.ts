import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveByteRange } from '@/lib/httpRange'
import { isPublicImageName } from '@/lib/items'
import { currentUser } from '@/lib/session'
import { THUMB_MIME } from '@/lib/thumbnail'
import {
  isAllowedContentMime,
  isValidAttachmentName,
  isValidVideoName,
} from '@/lib/uploads'

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
// ?thumb=1 は一覧用の縮小版 (src/lib/thumbnail.ts)。
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
  // 画像・音声のどちらの保存名も許す (docs/12-添付ファイル種類拡張メモ.md)
  if (!isValidAttachmentName(name)) {
    return NextResponse.json(
      { success: false, data: null, error: '不正なファイル名です' },
      { status: 400 },
    )
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
    return NextResponse.json(
      { success: false, data: null, error: 'ログインが必要です' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // 動くサムネ。**代替を一切しない**のが要点 — 無ければ 404 を返し、表示側は
  // それを「静止サムネのままでよい」の合図として使う (useAnimThumb.ts)。
  // 静止サムネで代替すると、表示側は差し替えが効いたのか効かなかったのかを
  // 見分けられず、生成されていない動画に何度も要求を出し続けることになる
  if (wantAnim) {
    const row = await prisma.image.findUnique({
      where: { name },
      select: { thumbAnim: true },
    })
    if (row?.thumbAnim) {
      return imageResponse(row.thumbAnim, THUMB_MIME, IMMUTABLE_CACHE)
    }
    return NextResponse.json(
      { success: false, data: null, error: '動くサムネイルがありません' },
      { status: 404, headers: { 'Cache-Control': FALLBACK_CACHE } },
    )
  }

  // サムネだけを引く。原寸 (data) は数 MB ありうるので、一覧の 20 枚分を
  // 読んでから捨てることのないよう列を分けて取る
  if (wantThumb) {
    const row = await prisma.image.findUnique({
      where: { name },
      select: { thumb: true },
    })
    if (row?.thumb) {
      return imageResponse(row.thumb, THUMB_MIME, IMMUTABLE_CACHE)
    }
    // 動画はサムネが無くても**原寸で代替しない**。poster が無いだけで数十 MB の
    // 動画本体を返してしまうと、一覧や <video poster> の意図に反する。404 を返せば
    // ブラウザは poster を静かに無視する (docs/14 §Phase4)。行が無い場合も 404。
    if (isValidVideoName(name)) {
      return NextResponse.json(
        { success: false, data: null, error: 'サムネイルがありません' },
        { status: 404, headers: { 'Cache-Control': FALLBACK_CACHE } },
      )
    }
    // 画像は未生成 (バックフィル前・生成失敗) なら原寸で代替する。一覧は重くなるが
    // 絵は出る。行そのものが無い場合もここを抜け、下の 404 に合流する
  }

  const image = await prisma.image.findUnique({
    where: { name },
    select: { mime: true, data: true },
  })

  if (!image) {
    return NextResponse.json(
      { success: false, data: null, error: '画像が見つかりません' },
      { status: 404 },
    )
  }

  return dataResponse(
    request,
    image.data,
    // 保存時に検証済みだが、DB の値をそのまま信用せず既知の MIME のときだけ採用する
    isAllowedContentMime(image.mime) ? image.mime : 'application/octet-stream',
    wantThumb ? FALLBACK_CACHE : IMMUTABLE_CACHE,
  )
}

function imageResponse(
  data: Uint8Array,
  contentType: string,
  cacheControl: string,
): NextResponse {
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      // ユーザー由来のバイト列を配信するため MIME スニッフィングを禁止
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

// 原寸データの配信。音声 (<audio>) のシークに応えるため Range に対応する
// (docs/12-添付ファイル種類拡張メモ.md)。画像も同じ経路を通るが、Range
// ヘッダが無ければ従来どおり 200 で全体を返すので挙動は変わらない。
function dataResponse(
  request: Request,
  data: Uint8Array,
  contentType: string,
  cacheControl: string,
): NextResponse {
  const size = data.byteLength
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    // Range を解さないクライアントにも「部分取得できる」と知らせる
    'Accept-Ranges': 'bytes',
  }

  const range = resolveByteRange(request.headers.get('range'), size)
  if (range === 'unsatisfiable') {
    return new NextResponse(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` },
    })
  }
  if (range) {
    const slice = data.subarray(range.start, range.end + 1)
    return new NextResponse(new Uint8Array(slice), {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      },
    })
  }

  return new NextResponse(new Uint8Array(data), { headers })
}

// 配ってよい画像か。ログイン中なら全部、未ログインなら公開ノートに
// 貼られているものだけ。
//
// ログイン検査を先に置く (uploads.ts と同じ流儀)。持ち主の閲覧で毎回
// items を走査しないため
async function canView(name: string): Promise<boolean> {
  if ((await currentUser()) !== null) {
    return true
  }
  return isPublicImageName(name)
}
