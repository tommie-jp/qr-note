import type { BookSummary } from './book'
import type { ProductSummary } from './product'
import { parseTagToken } from './markdown/tags/tags'

// スキャンした未登録コードから新規ノートを作る導線の組み立て
// (設計は docs/10-スキャン新規登録計画.md)。
//
// コードは itemNo ではなくタグ (#9784873115658) として本文に置く。
// 正本はメモ本文というこのアプリの流儀に揃い、tags 派生キャッシュ・
// タグリンク・タグチップが既存の仕組みでそのまま動く。

// このコードをタグとして本文に置けるか。
//
// 判定は markdown/tags/tags.ts の parseTagToken に委ねる。タグ記法の正規表現をここへ
// 書き写すと、tags 側が変わったとき「ボタンは出るのにタグにならない」
// (逆も) が黙って起きる。#付きで渡して「タグ 1 個ちょうど」かを聞く。
export function isTaggableCode(code: string): boolean {
  return parseTagToken(`#${code}`) !== null
}

// 978 / 979 で始まる 13 桁は書籍用に予約された EAN-13 の接頭辞 (Bookland)。
// つまり読み取った数字だけで書籍だと分かる (JAN や DataMatrix と違い、
// 読み取ったフォーマットの情報が要らない)。
//
// ただし 979 帯のうち 9790 だけは ISMN (印刷楽譜の番号) で書籍ではないので外す。
// 978x… と 9791-9799… の 2 通りを書く。
const ISBN_PATTERN = /^(?:978[0-9]|979[1-9])[0-9]{9}$/

// このコードが ISBN か (docs/10-スキャン新規登録計画.md §5)。
//
// 接頭辞と桁数だけでなくチェックデジットも検算する。スキャン経由なら zxing が
// EAN-13 の検算を済ませているが、検索窓に手入力した番号はここだけが頼りで、
// 検算しないと「ISBN である」と名乗る関数が嘘をつく。
export function isIsbn(code: string): boolean {
  return ISBN_PATTERN.test(code) && hasEan13CheckDigit(code)
}

// EAN-13: 左から重み 1,3,1,3... を掛けた総和 (チェックデジット込み) が 10 の倍数
function hasEan13CheckDigit(code: string): boolean {
  const sum = [...code].reduce(
    (acc, char, i) => acc + Number(char) * (i % 2 === 0 ? 1 : 3),
    0,
  )
  return sum % 10 === 0
}

// このコードが JAN (書籍以外の EAN-13) か (docs/14-JAN商品情報取得計画.md §2)。
//
// 45/49 (日本) には縛らない。輸入品も国内 EC ではそのまま売られていて、
// Yahoo!ショッピングでヒットする。ISBN を先に除くので書籍は常に書籍側の
// 導線 (bookLookup) に行き、ISMN (9790 = 印刷楽譜) は isIsbn が偽なので
// こちらに落ちる (楽譜も EC でヒットしうるので専用の分岐は作らない)。
const JAN_PATTERN = /^[0-9]{13}$/

export function isJan(code: string): boolean {
  return JAN_PATTERN.test(code) && !isIsbn(code) && hasEan13CheckDigit(code)
}

// 書影の表示幅 (px)。原寸は 200x200 前後で、本文にそのまま出ると邪魔になる。
// 画像自体は無改変で、表示幅だけを指定する (docs/19-書影取得計画.md §2)
const COVER_WIDTH_PX = 120

// 見出し部分。書籍は 書名 / 著者 / 出版社 (刊行年月) / 書影、
// 商品は 商品名 / ブランド。
// 欠けた項目は行ごと落とし、本文の頭に空行が生まれないようにする。
//
// 書影は見出しの一番下。1 行目は書名のままにしないと、一覧の要約
// (memoSummary) が画像の記法になってしまう。
function bookHeader({
  title,
  authors,
  publisher,
  pubdate,
  coverImageUrl,
}: BookSummary): string {
  const imprint = publisher && pubdate ? `${publisher} (${pubdate})` : publisher || pubdate
  // alt が空だと読み上げで無名の画像になるので「書影」と入れる
  const cover = coverImageUrl ? `![書影|${COVER_WIDTH_PX}](${coverImageUrl})` : ''
  return [title, authors.join(' / '), imprint, cover].filter(Boolean).join('\n')
}

function productHeader({ title, brand }: ProductSummary): string {
  return [title, brand].filter(Boolean).join('\n')
}

// 事前入力する本文。タイトルを書くための空行 2 つの下にタグを置く。
//
// 一覧の要約 (memoSummary) は空行を飛ばすので、何も書かないうちは要約が
// #コードになり「タイトルはスキャンしたコード」が満たされる。1 行目に
// 書名・部品名を書けば要約がそれへ差し替わり、タグは下に残る。
// CodeMirror の既定カーソル位置 (文書先頭) がそのままタイトルを書く位置。
//
// タグは読み取った綴りのまま置く (正規化は tags キャッシュ側の仕事)。
//
// ISBN なら #book も付ける。「持っている本を一覧したい」は自然に起きる括りで、
// タグにする価値がある。#isbn と #book の併記はしない (ISBN を持つノート =
// 書籍で同じ集合を指し、タグ一覧のノイズが倍になるだけ)。誤判定しても
// カーソルが載った編集ページが開いているので、その場で消せる。
//
// summary を渡すと書誌 (書名・著者・出版社) や商品情報 (商品名・ブランド) が
// 上に載る (docs/13-書誌自動取得計画.md / docs/14-JAN商品情報取得計画.md)。
// 1 行目に書名・商品名が来るので一覧の要約がそれになり、全文検索でも
// 引けるようになる。引けなければ従来どおり手で書く。
// 2 つの型は authors の有無で見分ける (判別用のフィールドは足さない)。
export function scanRegisterMemo(
  code: string,
  summary?: BookSummary | ProductSummary | null,
): string {
  const kind = isIsbn(code) ? ' #book' : ''
  const header = !summary
    ? ''
    : 'authors' in summary
      ? bookHeader(summary)
      : productHeader(summary)
  return `${header}\n\n#${code}${kind}`
}

// 「新規登録」ボタンのリンク先。itemNo は採番済みの次番号を渡す。
export function scanRegisterHref(itemNo: string, code: string): string {
  return `/edit/${itemNo}?code=${encodeURIComponent(code)}`
}
