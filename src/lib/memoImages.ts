// メモ本文に貼られた画像の参照を読む (docs/23-検索結果表示モード計画.md §4)。
//
// 画像とノートの関係は DB に無い。参照は本文に書かれた
// `/api/images/<UUID>.<ext>` という文字列だけである (docs/20-画像GC計画.md §1)。
// 一覧のサムネに「そのノートの画像」を出すには、本文を読むしかない。
//
// 検索は memo を丸ごと引いているので、ここは追加の問い合わせを呼ばない。
// 遅くなったら tags / props と同じく「保存時に計算する派生キャッシュ列」へ
// 移せる (そのときもこの関数が正本の抽出規則として残る)。

import { stripCode } from './tags'
import { isValidAttachmentName, isValidImageName, isValidVideoName } from './uploads'

// Markdown の画像記法 `![alt](url)` の url を捕捉する。
// リンク記法 `[text](url)` は先頭の `!` が無いので外れる — 貼った画像ではなく
// ただのリンクなので、サムネにする対象ではない。
const IMAGE_SYNTAX = /!\[[^\]]*\]\(([^)\s]+)\)/g

// 自前の画像だけを対象にする。外部の画像 (https://...) はサムネを持たないうえ、
// 一覧を開くだけで外部へ 20 本の要求が飛ぶことになるので拾わない。
const IMAGE_PATH_PREFIX = '/api/images/'

// 本文中の画像参照 `/api/images/<oldName>` を新しい名前に総入れ替えする
// (docs/49-画像回転計画.md §3)。回転は画像を新 UUID で保存し直すため、本文の
// 旧 URL を新 URL に書き換える必要がある。
//
// 置換は URL の**名前部分だけ**を対象にするので、`![alt|200](...)` の幅記法や
// alt はそのまま残る。名前は UUID で一意なので、たまたま別の文字列に埋まる
// 心配はない (path prefix も付けて余計な一致を避ける)。
export function replaceImageName(
  memo: string,
  oldName: string,
  newName: string,
): string {
  return memo.split(`${IMAGE_PATH_PREFIX}${oldName}`).join(
    `${IMAGE_PATH_PREFIX}${newName}`,
  )
}

// 本文に貼られた自前画像の名前を出てくる順に列挙する。
// コードフェンス・インラインコードの中は対象外 (tags.ts / props.ts と同じ流儀)。
// firstImageName / allImageNames の共通の抽出規則。
function* iterImageNames(memo: string): Generator<string> {
  for (const match of stripCode(memo).matchAll(IMAGE_SYNTAX)) {
    // 書式の検算。名前は配信 URL に組み立てる値なので、本文から拾った文字列を
    // そのまま信じない (route.ts が 400 で弾く形と同じ線引きをここでも敷く)
    const name = attachmentNameFromUrl(match[1])
    if (name !== null && isValidImageName(name)) {
      yield name
    }
  }
}

// 本文に最初に現れる自前画像の名前 (`<UUID>.<ext>`)。無ければ null。
export function firstImageName(memo: string): string | null {
  for (const name of iterImageNames(memo)) {
    return name
  }
  return null
}

// 一覧サムネにできる添付 (画像 or 動画) を出現順に列挙する。
// 画像はサムネを、動画は poster を **同じ thumb カラム**に持つので、どちらも
// ?thumb=1 で縮小版を配れる (docs/14-動画挿入計画.md)。音声・PDF・テキストは
// thumb を持たないので対象外 (一覧では文字だけ)。
//
// **画像検索の索引 (allImageNames) には動画を混ぜない** — あちらは画像だけを
// 対象にする既存方針 (uploads.ts の isValidImageName のコメント)。ここは
// 「一覧の顔になる絵」を選ぶ別用途なので、poster を持つ動画も含める。
function* iterThumbAttachments(
  memo: string,
): Generator<{ name: string; isVideo: boolean }> {
  for (const match of stripCode(memo).matchAll(IMAGE_SYNTAX)) {
    const name = attachmentNameFromUrl(match[1])
    if (name === null) {
      continue
    }
    if (isValidImageName(name)) {
      yield { name, isVideo: false }
    } else if (isValidVideoName(name)) {
      yield { name, isVideo: true }
    }
  }
}

// 本文で最初にサムネにできる添付 (画像 or 動画)。無ければ null。
// 出現順で選ぶ (画像を優先しない) — 本文の最初の絵/動画をそのノートの顔にする。
// 録画だけのノートでも動画の poster が一覧サムネになる。
export function firstThumbInfo(
  memo: string,
): { name: string; isVideo: boolean } | null {
  // 添付 URL の気配が無い本文は stripCode ごと飛ばす (circuitThumbs.ts の
  // 足切りと同じ)。一覧は全行 (SSR + hydration + プレビュー対象判定) で
  // これを呼ぶので、大半のノートを includes 1 回で済ませる
  if (!memo.includes(IMAGE_PATH_PREFIX)) {
    return null
  }
  for (const info of iterThumbAttachments(memo)) {
    return info
  }
  return null
}

// 本文に貼られた自前の添付を種類を問わず (画像・動画・音声・PDF・テキスト)
// 出現順・重複除去で返す (docs/65-オフライン対応計画.md §10)。
//
// **firstThumbInfo / allImageNames とは用途が違う。** あちらは「一覧の顔」と
// 「画像検索の索引」で、混ぜると音声や PDF がサムネ候補に紛れ込む
// (isValidAttachmentName を分けている理由。uploads.ts)。こちらは
// 「このノートを圏外で開くのに要るファイル一式」なので、逆に 1 つも
// 落とせない — 落とすと印を付けたのに開けない添付が残る。
//
// hasThumb は一覧サムネ (?thumb=1) を持つか。持つのは画像と動画だけで、
// 音声・PDF・テキストは thumb 列を持たない。
export function allAttachments(memo: string): { name: string; hasThumb: boolean }[] {
  const seen = new Map<string, boolean>()
  for (const match of stripCode(memo).matchAll(IMAGE_SYNTAX)) {
    // 幅記法や query が付いた形は本文には現れない (挿入は必ず素の URL) が、
    // 拾った文字列をそのまま信じないのはこのファイルの流儀 (iterImageNames)
    const name = attachmentNameFromUrl(match[1])
    if (name === null || !isValidAttachmentName(name) || seen.has(name)) {
      continue
    }
    seen.set(name, isValidImageName(name) || isValidVideoName(name))
  }
  return [...seen].map(([name, hasThumb]) => ({ name, hasThumb }))
}

// 添付の配信 URL (原寸)。
export function attachmentUrl(name: string): string {
  return `${IMAGE_PATH_PREFIX}${name}`
}

// 配信 URL (`/api/images/<name>`) から保存名を取り出す (attachmentUrl の逆)。
// 自前の添付でなければ null。**書式の検算はしない** — 呼ぶ側が用途に応じた
// isValid*Name で確かめること (このファイルの流儀: 拾った文字列を信じない)
export function attachmentNameFromUrl(url: string): string | null {
  return url.startsWith(IMAGE_PATH_PREFIX)
    ? url.slice(IMAGE_PATH_PREFIX.length)
    : null
}

// 本文に貼られた自前画像の名前をすべて (出現順・重複除去) 返す。
// 画像検索の索引づくりで、1 ノートに複数枚ある写真を全部照合対象にするため
// 使う (docs/25-画像検索計画.md §4)。firstImageName と同じ抽出規則。
export function allImageNames(memo: string): string[] {
  const seen = new Set<string>()
  for (const name of iterImageNames(memo)) {
    seen.add(name)
  }
  return [...seen]
}

// サムネ生成パラメータ (thumbnail.ts) の版。パラメータを変えたら上げる。
//
// ?thumb=1 は 1 年 immutable でブラウザに焼かれる (route.ts の IMMUTABLE_CACHE)
// ため、DB の thumb を作り直しても URL が同じだと閲覧者には旧サムネが残る。
// URL に版を混ぜておけば、版を上げた瞬間に全参照が別 URL になりキャッシュを
// 割って新サムネを取り直す。route はこの値を読まない (thumb=1 だけを見る) ので
// 増やすだけでよい。v1: 長辺 320 inside → v2: 正方形 384 cover → v3: 384 inside
// (縦横比維持に戻す。画像モードのタイルを contain 全体表示に変えたため。docs/32 §1)
// v4: GIF・アニメ WebP はサムネもアニメにする (一覧で動かす)。既存分は
// backfillThumbs.ts --force で作り直すと版も変わり旧サムネのキャッシュも割れる
const THUMB_VERSION = 4

// 一覧のサムネ配信 URL。?thumb=1 は縮小版を返す
// (src/app/api/images/[name]/route.ts)。v はキャッシュバスター (上記)。
export function thumbUrl(name: string): string {
  return `${IMAGE_PATH_PREFIX}${name}?thumb=1&v=${THUMB_VERSION}`
}
