// ZIP を 1 つ、画面を通さずに取り込む (手元の確かめ用。docs/104 §7)。
// 使い方: DATABASE_URL=… npx tsx --conditions=react-server scripts/importZipFile.ts <ZIP> [skip|overwrite|renumber]
import 'dotenv/config'
import { createReadStream } from 'node:fs'
import { prisma } from '@/lib/db'
import { parseConflictPolicy } from '@/lib/zip/conflictPolicy'
import { importZip } from '@/lib/zip/importZip'

async function main(): Promise<void> {
  const [path, policy] = process.argv.slice(2)
  if (!path) {
    throw new Error('usage: importZipFile.ts <ZIP> [skip|overwrite|renumber]')
  }
  const conflict = parseConflictPolicy(policy ?? null)
  if (conflict === null) {
    throw new Error('conflict は skip / overwrite / renumber')
  }
  // 撮影情報はアプリの既定どおり消す (docs/113)。ログインしないので利用者の設定は引けない
  const report = await importZip(createReadStream(path), { conflict, photoMeta: 'strip' })
  console.log(
    JSON.stringify(
      {
        imported: report.imported.length,
        skipped: report.skipped.length,
        conflictSkipped: report.conflictSkipped,
        duplicateSkipped: report.duplicateSkipped,
        restoredAttachments: report.restoredAttachments,
      },
      null,
      1,
    ),
  )
  for (const one of report.skipped.slice(0, 10)) {
    console.log('  見送り', JSON.stringify(one).slice(0, 200))
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
