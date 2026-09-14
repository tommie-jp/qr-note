// 取り込み画面 (components/NotesImporter.tsx・components/transfer/ImportResult.tsx) が
// 描くための形と、描く前の判定 (docs/28-エクスポート計画.md §3 / §4)。
//
// 型と純関数だけを置き、画面からもテストからもそのまま読めるようにする。
// **server 専用の依存を持ち込まないこと** (lib/import/importReport.ts と同じ制約)。

import { enexTooLargeMessage, MAX_ENEX_BYTES } from '../enex/limits'
import type { BaseImportReport } from './importReport'
import { MAX_ZIP_BYTES, zipTooLargeMessage } from '../zip/limits'

// /api/import が返すレポート。**format で見分ける判別可能ユニオン**にして、
// 「ZIP なのに restoredAttachments が無い」ような組み合わせを型で締め出す
// (共通部分は lib/import/importReport.ts が正本)。duplicateSkipped は両方が持つが、
// 意味は違う — ENEX は「既に取り込み済み」、ZIP は「衝突したが同内容だった」
export type ImportReport =
  | ({ format: 'zip' } & BaseImportReport & {
        conflictSkipped: number
        duplicateSkipped: number
        restoredAttachments: number
      })
  | ({ format: 'enex' } & BaseImportReport & { duplicateSkipped: number })

// 大きさと名前だけを見る (File の他の性質は要らない)
type PickedFile = Pick<File, 'name' | 'size'>

// 拡張子で「どちらの形式のつもりか」を見る。**実際の振り分けはサーバが中身の
// 先頭バイトで行う** (拡張子は付け替えられる) ので、ここで見るのは
// 上限の出し分けと、上書き選択を出すかどうかの案内のためだけ。
export function looksLikeZip(file: Pick<File, 'name'>): boolean {
  return file.name.toLowerCase().endsWith('.zip')
}

// 上限を超えていれば理由、収まっていれば null。**呼ぶたびに同じ答えになる**
// ので状態には持たず、その場で求める
export function tooLargeMessage(file: PickedFile | null): string | null {
  if (file === null) {
    return null
  }
  if (looksLikeZip(file)) {
    return file.size > MAX_ZIP_BYTES ? zipTooLargeMessage(file.size) : null
  }
  return file.size > MAX_ENEX_BYTES ? enexTooLargeMessage(file.size) : null
}

// 番号を振り直して入れたノートの数。QR シールの貼り替えに直結するので、
// 一覧の「旧 → 新」とは別に件数でも出す
export function countRenumbered(report: Pick<BaseImportReport, 'imported'>): number {
  return report.imported.filter((note) => note.renumberedFrom !== undefined).length
}
