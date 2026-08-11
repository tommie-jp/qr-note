// シークレット断片の記法と名前 (docs/51-部分暗号化計画.md §3)。
//
// 本文には暗号文を書かず、参照だけを書く。記法は**画像と同じ** `![ラベル](URL)`
// で、URL が `/api/secrets/<UUID>` のときだけシークレットとして扱う。
//
// 独自記法 (`!secret[…](…)`) ではなく画像記法に相乗りするのが要点:
// このアプリは音声・動画・PDF・テキストも既に画像記法で本文へ入れており
// (MarkdownView の imgRenderer が src で描き分ける)、記法を増やさなければ
// パーサ・サニタイズ・GC・本文置換のどれにも新しい経路が要らない。
//
// **ラベルは平文のまま本文に残る**。全文検索・タグ集計はそのまま効き、その
// 代わり「何のシークレットか」はサーバ管理者にも見える (docs/51 §1 の割り切り)。

import { stripCode } from './tags'

export const SECRET_PATH_PREFIX = '/api/secrets/'

// 鍵の設定画面 (初回設定・解錠・復旧キー)。ヘッダのメニューとページの
// 両方が同じ文字列を要るので、authPaths.ts と同じ理由でここに一度だけ書く
export const SECRET_SETTINGS_PATH = '/settings/secrets'

// 保存名はサーバが振った UUID だけ。**拡張子を持たない**のが画像・音声との
// 違いで、これによって isValidImageName 系とは決して取り違えない
// (一覧サムネ・画像検索・OCR はシークレットを拾わない)。
const SECRET_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// ラベルが空のときの表示名 (MarkdownView の既定ラベルと揃える)
export const DEFAULT_SECRET_LABEL = 'シークレット'

export function isValidSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name)
}

export function secretUrl(name: string): string {
  return `${SECRET_PATH_PREFIX}${name}`
}

// 本文へ書く記法。ラベルは記法を壊さない形に均してから入れる。
export function secretNotation(label: string, name: string): string {
  return `![${secretLabel(label)}](${secretUrl(name)})`
}

// 記法を壊す文字を落としたラベル。`[` `]` と改行は `![…](…)` そのものを
// 壊すため除く (画像の attachmentAltText と同じ線引き)。
export function secretLabel(raw: string): string {
  const cleaned = raw.replace(/[[\]\r\n]/g, '').trim()
  return cleaned.length > 0 ? cleaned : DEFAULT_SECRET_LABEL
}

// 画像記法の URL がシークレット参照なら名前を返す。そうでなければ null。
//
// 書式の検算までここで済ませる。本文から拾った文字列は配信 URL の組み立てや
// SQL の position() へ渡るので、そのまま信じない (memoImages.ts と同じ流儀)。
export function secretNameFromUrl(url: string): string | null {
  if (!url.startsWith(SECRET_PATH_PREFIX)) {
    return null
  }
  const name = url.slice(SECRET_PATH_PREFIX.length)
  return isValidSecretName(name) ? name : null
}

// 画像記法 `![alt](url)` の url を捕捉する (memoImages.ts と同じ正規表現)。
const IMAGE_SYNTAX = /!\[[^\]]*\]\(([^)\s]+)\)/g

// alt (ラベル) も一緒に捕まえる版。カーソル位置の判定と保存後の置換に使う。
const LABELLED_IMAGE_SYNTAX = /!\[([^\]]*)\]\(([^)\s]+)\)/g

export interface SecretNotationHit {
  name: string
  label: string
  // 本文中の記法の範囲 (置換に使う)
  from: number
  to: number
}

function* iterNotations(memo: string): Generator<SecretNotationHit> {
  for (const match of memo.matchAll(LABELLED_IMAGE_SYNTAX)) {
    const name = secretNameFromUrl(match[2])
    if (name === null || match.index === undefined) {
      continue
    }
    yield {
      name,
      label: secretLabel(match[1]),
      from: match.index,
      to: match.index + match[0].length,
    }
  }
}

// カーソルが乗っているシークレット記法。無ければ null。
//
// 編集ボタンが「新規」と「その断片を開く」を兼ねるための判定
// (ocrQuote.ts の imageAtCursor と同じ役どころ)。**両端も含める** —
// 記法の直後にカーソルを置いた状態は「その断片を触っている」と見なすのが自然。
//
// コードフェンスは除かない (allSecretNames とは違う)。編集中の本文で
// 「いま触っている記法」を拾うだけなので、書きかけのフェンスの中でも
// 掴めた方が困らない。
export function secretAtCursor(
  memo: string,
  cursor: number,
): SecretNotationHit | null {
  for (const hit of iterNotations(memo)) {
    if (cursor >= hit.from && cursor <= hit.to) {
      return hit
    }
  }
  return null
}

// エディタのツールバーに出す文字 (docs/52-シークレット編集導線計画.md §1)。
//
// ボタンの動作は元から「カーソルが記法の上なら編集、そうでなければ新規」に
// 分かれているが、見た目が同じだと**編集できること自体に気づけない**。
// 文字を変えるだけで、押した先の分岐 (openSecret) は今までどおり。
export function secretToolbarLabel(memo: string, cursor: number): string {
  return secretAtCursor(memo, cursor) === null ? '秘密' : '秘密を編集'
}

// 本文にあるシークレット記法の範囲をすべて返す (docs/76-ノート内検索計画.md §5-4)。
//
// 用途は「置換から守る」こと。`/api/secrets/<名前>` の名前が 1 文字でも
// 変われば、暗号化された断片への参照が切れて**戻せない** (本文だけを見ても
// どの断片だったか判らない)。ノート内の全置換はこの範囲に重なる一致を飛ばす。
//
// secretAtCursor と同じくコードフェンスは除かない — 除くと「見えている
// 記法なのに守られない」場所ができる。守る側は広めに取るのが安全。
export function secretNotationRanges(
  memo: string,
): { from: number; to: number }[] {
  return [...iterNotations(memo)].map(({ from, to }) => ({ from, to }))
}

// 名前から記法の範囲を引く。編集を保存した後にラベルを差し替えるために使う。
// **位置ではなく名前で引き直す**のが要点 — ダイアログを開いている間に本文が
// 動いていても正しい場所を置き換えられる (画像アップロードの replaceToken と
// 同じ考え方)。
export function findSecretNotation(
  memo: string,
  name: string,
): SecretNotationHit | null {
  for (const hit of iterNotations(memo)) {
    if (hit.name === name) {
      return hit
    }
  }
  return null
}

// 本文が参照しているシークレットの名前を出現順・重複なしで返す。
// コードフェンス・インラインコードの中は対象外 (tags.ts / memoImages.ts と同じ)。
//
// 用途は 2 つ: 断片の GC (docs/51 §11) と、閲覧前に「このノートに鍵の要る
// 断片がいくつあるか」を数えること。
export function allSecretNames(memo: string): string[] {
  const seen = new Set<string>()
  for (const match of stripCode(memo).matchAll(IMAGE_SYNTAX)) {
    const name = secretNameFromUrl(match[1])
    if (name !== null) {
      seen.add(name)
    }
  }
  return [...seen]
}
