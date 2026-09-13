// --- テキスト系 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md) ---
//
// txt / csv / md。音声・PDF と同じく変換もサムネも埋め込みもせず、そのまま
// images テーブルへ保存する。違いは 2 つだけ:
//
// - **中身の判定は署名ではなく「テキストとして読めるか」** (normalizeText.ts)。
// - **保存する拡張子はクライアントの申告 (ファイル名) から決める。** 中身からは
//   txt / csv / md を区別できないため。ただし申告文字列を保存名に使うのではなく、
//   既知の 3 つ (names.ts の TEXT_FORMAT_TO_MIME) のいずれかへ**写す**だけなので、
//   トラバーサルの余地は無い。
//
// 配信 mime (charset つき) と保存名の規則は names.ts が持つ
// (docs/93-リファクタリング計画.md §4-2)。

import { TEXT_EXTENSIONS, type TextFormat } from '../../textFormats'
import { TEXT_FORMAT_TO_MIME } from '../names'

// 元のファイル名から、保存に使う mime / ext を決める。txt/csv/md 以外の
// 名前なら null (= テキストとして受けない)。
//
// **知らない拡張子を txt に倒さないのが肝。** テキストには署名が無く、HTML も
// SVG も「テキストとしては妥当」なので、中身の判定だけでは何でも通ってしまう。
// 名前でも名乗らせることで、既存の「拡張子・MIME を偽装したものは弾く」
// 方針 (x.png と名乗る HTML は 400) をテキスト追加後も保てる。
//
// 申告文字列そのものは保存名に使わない。ここで既知の 3 つへ**写す**だけなので、
// トラバーサルの余地は無い。
export function textSaveInfo(
  fileName: string | null | undefined,
): { mime: string; ext: TextFormat } | null {
  // ドットのある末尾だけを拡張子とみなす。split('.').pop() だと、
  // "csv" という名前 (拡張子なし) が拡張子扱いになってしまう
  const suffix = /\.([a-z0-9]+)$/.exec((fileName ?? '').toLowerCase())?.[1]
  const ext = TEXT_EXTENSIONS.find((known) => known === suffix)
  return ext ? { mime: TEXT_FORMAT_TO_MIME[ext], ext } : null
}
