// 書き出しの覚え書き (docs/28-エクスポート計画.md §1)。ZIP の直下に
// export.json として 1 枚だけ入れる。
//
// 狙いは 3 つ:
//
//   1. **不具合の調査** … 手元に残った ZIP だけを見て、どの版がいつ書き出した
//      ものか判る。「取り込めない」と言われたときに版を尋ねずに済む
//   2. **将来フォーマットを変えたとき**の判断材料 (formatVersion)
//   3. **このアプリの ZIP だという印** … 関係のない ZIP を選んだときに、
//      取り込み側が「別物です」と言い切れる (importZip.ts)
//
// **取り込みはこれを要求しない**。この覚え書きが入る前に書き出した ZIP も、
// 手で組んだ vault (notes/ と images/ を並べただけ) も、これまでどおり
// 取り込めなければならない。あれば読む、無ければ無いで読む。
//
// exportedAt を入れると、同じ内容でも書き出すたびに ZIP のバイト列が変わる
// (バックアップの差分・重複排除とは相性が悪い)。それでも入れてあるのは、
// 個人の道具としては「いつ書き出したか」が判るほうが実際に助かるため。

import pkg from '../../../package.json'

// 形式の名前。ファイル名 (export.json) は誰でも付けられるので、中身でも名乗る
export const EXPORT_FORMAT = 'qr-search-export'

// 形式の版。**中身の意味を変えたときだけ上げる** (項目を足すだけなら据え置き。
// 読む側は知らない項目を無視すればよい)
export const EXPORT_FORMAT_VERSION = 1

export interface ExportMeta {
  format: string
  formatVersion: number
  appVersion: string
  exportedAt: string
  noteCount: number
}

// export.json の中身を組み立てる。**人が開いて読む前提**で整形して入れる
// (ZIP を展開して中身を確かめるのはたいてい困っているときなので)。
export function buildExportMeta(noteCount: number, exportedAt: Date): string {
  const meta: ExportMeta = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    appVersion: pkg.version,
    exportedAt: exportedAt.toISOString(),
    noteCount,
  }
  return `${JSON.stringify(meta, null, 2)}\n`
}
