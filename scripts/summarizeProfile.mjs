#!/usr/bin/env node
// profileAll.sh の出力を表にする (docs/127 §2-1・§3・§4-1 と同じ並び)。
// 2 つ目の引数に基準のディレクトリを渡すと、中央値の差と docs/127 §8 の判定を足す。
//
//   node scripts/summarizeProfile.mjs perf-baseline/phase2 [perf-baseline/base]
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, baseDir] = process.argv.slice(2)
if (!dir) {
  console.error('使い方: summarizeProfile.mjs <計測のディレクトリ> [基準のディレクトリ]')
  process.exit(2)
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// サーバ: 2〜6 回目 (1 回目は起動直後) の項目ごとの中央値・最小・最大と、最後の周回の RSS
function serverSummary(root) {
  const runs = []
  for (let n = 2; existsSync(join(root, `server-run${n}.json`)); n += 1) {
    runs.push(readJson(join(root, `server-run${n}.json`)))
  }
  if (runs.length === 0) {
    return null
  }
  const ids = runs[0].items.map((item) => item.id)
  const items = Object.fromEntries(
    ids.map((id) => {
      const values = runs.map((run) => run.items.find((item) => item.id === id)?.medianMs).filter((v) => v !== undefined)
      return [id, { median: median(values), min: Math.min(...values), max: Math.max(...values) }]
    }),
  )
  const finalRss = runs.map((run) => run.memoryRounds?.at(-1)?.memory.rssMB).filter((v) => v !== undefined)
  return { items, finalRss }
}

function browserSummary(root) {
  const path = join(root, 'browser.json')
  if (!existsSync(path)) {
    return null
  }
  const report = readJson(path)
  const rows = {}
  for (const result of report.results) {
    for (const step of result.steps) {
      rows[`${result.profile} ${step.step}`] = step.ms
    }
  }
  const leak = report.results.find((r) => r.leak.length > 0)?.leak.map((r) => r.heapMB) ?? []
  return { rows, leak }
}

function peakSummary(root) {
  const path = join(root, 'peak-memory.json')
  if (!existsSync(path)) {
    return null
  }
  return Object.fromEntries(readJson(path).map((row) => [row.task, { mb: row.treeMaxRssMB, ms: row.ms }]))
}

// docs/127 §8: 幅の中なら変化なし、幅を超えて 10% 以上の悪化は止める
function judge(now, base) {
  if (!base) {
    return ''
  }
  const diff = now.median - base.median
  const pct = base.median === 0 ? 0 : (diff / base.median) * 100
  const sign = diff >= 0 ? '+' : ''
  let verdict = '変化なし'
  if (now.median > base.max) {
    verdict = pct >= 10 ? '**悪化 (調べる)**' : '悪化 (10% 未満)'
  } else if (now.median < base.min) {
    verdict = '改善'
  }
  return ` | ${sign}${pct.toFixed(0)}% | ${verdict}`
}

const fmt = (stat) => `${stat.median} (${stat.min}〜${stat.max})`

function printTable(title, header, rows) {
  console.log(`\n### ${title}\n`)
  console.log(header)
  console.log(header.replace(/[^|]+/g, (cell) => ` ${'-'.repeat(Math.max(3, cell.trim().length))} `).replace(/\s+\|/g, ' |'))
  for (const row of rows) {
    console.log(row)
  }
}

const now = { server: serverSummary(dir), browser: browserSummary(dir), peak: peakSummary(dir) }
const base = baseDir ? { server: serverSummary(baseDir), browser: browserSummary(baseDir), peak: peakSummary(baseDir) } : null
const compareCols = base ? ' | 差 | 判定' : ''

if (now.server) {
  printTable(
    'サーバ (ms、2〜6 回目)',
    `| 項目 | 中央値 (最小〜最大)${compareCols} |`,
    Object.entries(now.server.items).map(
      ([id, stat]) => `| ${id} | ${fmt(stat)}${judge(stat, base?.server?.items[id])} |`,
    ),
  )
  console.log(`\n周回の終わりの RSS (MB): ${now.server.finalRss.join(' → ')}`)
  if (base?.server) {
    console.log(`基準: ${base.server.finalRss.join(' → ')}`)
  }
}
if (now.browser) {
  printTable(
    'ブラウザ (ms)',
    `| 段 | 中央値 (最小〜最大)${compareCols} |`,
    Object.entries(now.browser.rows).map(
      ([name, stat]) => `| ${name} | ${fmt(stat)}${judge(stat, base?.browser?.rows[name])} |`,
    ),
  )
  console.log(`\n往復のヒープ (MB): ${now.browser.leak.join(' → ')}`)
  if (base?.browser) {
    console.log(`基準: ${base.browser.leak.join(' → ')}`)
  }
}
if (now.peak) {
  printTable(
    '重い処理のピーク (MB)',
    `| 処理 | ピーク RSS${compareCols} |`,
    Object.entries(now.peak).map(([task, row]) => `| ${task} | ${fmt(row.mb)}${judge(row.mb, base?.peak?.[task]?.mb)} |`),
  )
}
