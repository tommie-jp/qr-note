// Evernote の .enex をローカル (WSL) から取り込む CLI
// (設計は docs/28-エクスポート計画.md §4)。
//
// **なぜ CLI があるのか**: 変換はメモリを食う。実データ (40.2MB) を Web の口
// (/api/import) へ投げると本番 VPS (RAM 2GB / swap 常用。docs/09) では重い。
// ローカルは潤沢なので、変換だけ手元でやって結果を DB へ書く。
// vps2 のイメージをローカルでビルドして送る doDeploy.sh と同じ考え方で、
// 「重い処理は手元、成果物だけ本番へ」に揃えている。
//
// **取り込みの中身は Web と同じ** — importEnex() をそのまま呼ぶだけ。
// 変換規則・レポート・巻き戻しを 2 か所に持たない (docs/28 §4)。
//
// 接続先は DATABASE_URL。vps2 へ入れるときは SSH トンネルを張った上で
// そちらを指す (doImportEnex.sh が面倒を見る)。
//
// 使い方:
//   npx tsx --conditions=react-server scripts/importEnex.ts <file.enex...> [オプション]
//
//   --check     ファイルを読むだけ (DB に触らない)。件数と、取り込めない
//               ノートを先に知りたいときに使う
//   --no-embed  画像検索の索引を作らない (既定は作る)。Web の口と違って
//               ローカルはメモリに余裕があるので、既定でその場まで作る
//   --tag NAME  取り込む全ノートにタグ NAME を追記する (ノートブック名の
//               代わり)。#evernote は指定しなくても必ず付く
//   --force     既に取り込み済みのノートも入れ直す (既定はスキップ)
//   --yes       確認プロンプトを省く
//
// 複数ファイルを渡すと順に取り込む (Evernote で複数ノートを選択して
// 書き出すと 1 ファイルに複数ノートが入るが、ノートブック単位で分けて
// 書き出したものを一度に流したいとき用)。

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { prisma } from '@/lib/db'
import { enmlRejectReason } from '@/lib/enex/enmlToMarkdown'
import { type ImportReport, importEnex } from '@/lib/enex/importEnex'
import {
  EVERNOTE_TAG,
  MAX_CLI_ATTACHMENT_BYTES,
  MAX_CLI_ENEX_BYTES,
} from '@/lib/enex/limits'
import { decodeResourceData, parseEnex } from '@/lib/enex/parseEnex'

interface Args {
  files: string[]
  check: boolean
  embed: boolean
  force: boolean
  yes: boolean
  extraTags: string[]
}

const USAGE =
  '使い方: npx tsx --conditions=react-server scripts/importEnex.ts <file.enex...> [--check] [--no-embed] [--tag NAME] [--force] [--yes]'

function parseArgs(argv: string[]): Args {
  const files: string[] = []
  const extraTags: string[] = []
  const flags = { check: false, embed: true, force: false, yes: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--check':
        flags.check = true
        break
      case '--no-embed':
        flags.embed = false
        break
      case '--force':
        flags.force = true
        break
      case '--yes':
        flags.yes = true
        break
      case '--tag': {
        // 値を取る。--tag の後に名前が無ければ使い方の誤り
        const value = argv[++i]
        if (value === undefined || value.startsWith('--')) {
          die('--tag にはタグ名が要ります (例: --tag レシピ)')
        }
        extraTags.push(value)
        break
      }
      default:
        if (arg.startsWith('--')) {
          die(`知らないオプション: ${arg}`)
        }
        files.push(arg)
    }
  }

  if (files.length === 0) {
    die(USAGE)
  }
  return { files, extraTags, ...flags }
}

function die(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`

// 接続先を人が読める形にする (パスワードは出さない)。
//
// **これを必ず出す**のが肝。同じコマンドでローカルにも本番にも書けてしまうので、
// 「いまどっちへ入れようとしているか」を目で確かめられないと事故になる。
function describeTarget(): string {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    die('DATABASE_URL が未設定。ローカルなら .env を、vps2 なら ./doImportEnex.sh を使うこと')
  }
  try {
    const url = new URL(raw)
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`
  } catch {
    return '(DATABASE_URL を解釈できない)'
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${question} [y/N] `)
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

// ファイルを読む。512MB を超えるものは readFileSync が意味不明なエラーで
// 落ちる前に断る (limits.ts の MAX_CLI_ENEX_BYTES)。
function readEnex(file: string): string {
  const stat = fs.statSync(file, { throwIfNoEntry: false })
  if (!stat) {
    die(`ファイルが無い: ${file}`)
  }
  if (stat.size > MAX_CLI_ENEX_BYTES) {
    die(
      `${file} は大きすぎます (${mb(stat.size)} / 上限 ${mb(MAX_CLI_ENEX_BYTES)})。\n` +
        '     Evernote 側でノートブックや選択を分けて書き出し直して下さい ' +
        '(docs/13-EVERNOTE全ノート移行メモ.md)',
    )
  }
  return fs.readFileSync(file, 'utf8')
}

// DB に触らずファイルだけ見る。取り込む前に「何件あって、何が入らないか」を
// 知るための下見
function check(file: string): number {
  const notes = parseEnex(readEnex(file))
  console.log(`\n[${path.basename(file)}] ノート: ${notes.length} 件`)

  let resources = 0
  let rejected = 0
  let bytes = 0
  const problems: string[] = []
  for (const note of notes) {
    resources += note.resources.length
    rejected += note.rejectedResources.length
    for (const bad of note.rejectedResources) {
      problems.push(`  添付が読めない: ${bad.fileName ?? bad.mime} (${bad.reason})`)
    }
    // 大きすぎる添付は取り込み時に落ちる。**下見で判るなら先に言う** —
    // 取り込んでから「本文には跡だけ残った」と知るのでは遅い
    for (const resource of note.resources) {
      const size = decodeResourceData(resource).byteLength
      bytes += size
      if (size > MAX_CLI_ATTACHMENT_BYTES) {
        problems.push(
          `  添付が大きすぎる: ${resource.fileName ?? resource.mime} ` +
            `(${mb(size)} / 上限 ${mb(MAX_CLI_ATTACHMENT_BYTES)})`,
        )
      }
    }
    const reason = enmlRejectReason(note.content)
    if (reason !== null) {
      problems.push(`  本文を変換できない: ${note.title || '(無題)'} — ${reason}`)
    }
  }

  console.log(
    `  添付: ${resources} 件 / 計 ${mb(bytes)} (読めないもの ${rejected} 件)`,
  )
  if (problems.length === 0) {
    console.log('  取り込めなさそうなものは見当たらない')
  } else {
    console.log(`  先に判る問題 (${problems.length} 件):`)
    for (const problem of problems.slice(0, 50)) {
      console.log(`  ${problem}`)
    }
    if (problems.length > 50) {
      console.log(`    ... 他 ${problems.length - 50} 件`)
    }
  }
  return notes.length
}

function printReport(file: string, report: ImportReport): void {
  console.log(`\n[${path.basename(file)}] 取り込み: ${report.imported.length} 件`)
  for (const note of report.imported.slice(0, 100)) {
    console.log(`  ${note.itemNo}  ${note.title || '(無題)'}`)
  }
  if (report.imported.length > 100) {
    console.log(`  ... 他 ${report.imported.length - 100} 件`)
  }

  if (report.duplicateSkipped > 0) {
    console.log(
      `既に取り込み済みでスキップ: ${report.duplicateSkipped} 件 ` +
        '(入れ直すには --force)',
    )
  }

  if (report.skipped.length > 0) {
    console.log(`入らなかったもの: ${report.skipped.length} 件`)
    for (const entry of report.skipped.slice(0, 100)) {
      console.log(`  ${entry.label}\n    → ${entry.reason}`)
    }
    if (report.skipped.length > 100) {
      console.log(`  ... 他 ${report.skipped.length - 100} 件`)
    }
  }

  if (report.deferredImageIndex > 0) {
    console.log(
      `画像 ${report.deferredImageIndex} 枚は画像検索の索引を作っていない。` +
        '作るには npm run backfill:embeddings',
    )
  }
}

// レポートはファイルにも残す。件数が多いと端末のスクロールから溢れるうえ、
// 「何が入らなかったか」は後から突き合わせたくなる (migrateFromVer1.ts と同じ流儀)
function saveReport(file: string, report: ImportReport): void {
  const reportPath = path.join(
    path.dirname(file),
    `${path.basename(file, path.extname(file))}-import-report.json`,
  )
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`  レポート: ${reportPath}`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.check) {
    console.log('下見 (DB には触らない)')
    let total = 0
    for (const file of args.files) {
      total += check(file)
    }
    if (args.files.length > 1) {
      console.log(`\n合計 ${total} ノート (${args.files.length} ファイル)`)
    }
    return
  }

  // 取り込む前に全ファイルを読んで件数を数える (確認プロンプトに出すため)。
  // ここで 512MB 超・不在も先に弾ける
  const loaded = args.files.map((file) => ({ file, xml: readEnex(file) }))
  const noteCounts = loaded.map(({ xml }) => parseEnex(xml).length)
  const totalNotes = noteCounts.reduce((sum, n) => sum + n, 0)

  const target = describeTarget()
  console.log(`書き込み先: ${target}`)
  console.log(`ファイル: ${args.files.length} 件 / 合計 ${totalNotes} ノート`)
  console.log(`画像検索の索引: ${args.embed ? 'その場で作る' : '作らない (後で backfill)'}`)
  // #evernote は常に付く。--tag はそれに足す分
  const fixedTags = [EVERNOTE_TAG, ...args.extraTags]
  console.log(`付けるタグ: ${fixedTags.map((t) => `#${t}`).join(' ')}`)
  if (args.force) {
    console.log('重複判定: 無効 (--force。取り込み済みも入れ直す)')
  }

  const before = await prisma.item.count()
  console.log(`いまのノート数: ${before} 件`)

  if (!args.yes && !(await confirm(`${target} へ ${totalNotes} ノートを取り込む。続行するか?`))) {
    console.log('中止した')
    return
  }

  const started = Date.now()
  for (const { file, xml } of loaded) {
    const report = await importEnex(xml, {
      embedImages: args.embed,
      // Web の口の 10MB は HTTP アップロードの都合。ファイルから読むここでは
      // 持ち込まない (iPhone の写真は普通に超える。limits.ts に理由)
      maxAttachmentBytes: MAX_CLI_ATTACHMENT_BYTES,
      // 自分のファイルを自分で渡すので、Web の 500 件上限は課さない
      maxNotes: Number.POSITIVE_INFINITY,
      fixedTags,
      allowDuplicate: args.force,
    })
    printReport(file, report)
    saveReport(file, report)
  }

  const after = await prisma.item.count()
  console.log(
    `\n所要 ${((Date.now() - started) / 1000).toFixed(1)} 秒 / ` +
      `ノート数: ${before} → ${after} 件`,
  )
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('取り込みに失敗:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
