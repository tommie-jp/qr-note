#!/usr/bin/env node
// 関数の長さ・複雑度・循環依存の歯止め (docs/128-リファクタリング計画2.md §3-0)。
//
// ESLint の 4 規則をプロジェクトの設定に重ねて src に流し、ファイルごとの件数が
// 基準 (scripts/complexity-baseline.json) より増えたら落ちる。新しいファイルの
// 基準は 0 件。直して減ったら `--update` で基準を書き直す (件数は減る一方になる)。
// 循環依存は madge で数え、生成物 (src/generated) を除いた本数が基準を超えたら落ちる。
//
//   node scripts/checkComplexity.mjs            # 検査 (CI)
//   node scripts/checkComplexity.mjs --update   # 基準を今の値に書き直す
//   node scripts/checkComplexity.mjs --list     # 違反を全部出す (直す候補を探す)
import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import madge from 'madge'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const BASELINE_PATH = resolve(ROOT, 'scripts/complexity-baseline.json')

// 規約 (~/.claude/rules の coding-style): 関数は 50 行未満・入れ子は 4 段まで
export const QUALITY_RULES = {
  'max-lines-per-function': ['warn', { max: 50, skipBlankLines: true, skipComments: true }],
  complexity: ['warn', 15],
  'max-depth': ['warn', 4],
  'max-params': ['warn', 5],
}
const RULE_IDS = Object.keys(QUALITY_RULES)
const IGNORES = ['src/generated/**', '**/*.test.ts', '**/*.test.tsx']

async function lintCounts() {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfig: [{ ignores: IGNORES }, { files: ['src/**/*.{ts,tsx}'], rules: QUALITY_RULES }],
  })
  const results = await eslint.lintFiles(['src/**/*.{ts,tsx}'])
  const counts = {}
  const details = []
  for (const result of results) {
    const file = relative(ROOT, result.filePath)
    for (const message of result.messages) {
      if (!RULE_IDS.includes(message.ruleId)) {
        continue
      }
      counts[file] ??= {}
      counts[file][message.ruleId] = (counts[file][message.ruleId] ?? 0) + 1
      details.push({ file, line: message.line, rule: message.ruleId, message: message.message })
    }
  }
  return { counts, details }
}

async function circularChains() {
  const graph = await madge(resolve(ROOT, 'src'), {
    fileExtensions: ['ts', 'tsx'],
    tsConfig: resolve(ROOT, 'tsconfig.json'),
    excludeRegExp: [/^generated\//, /\.test\.tsx?$/],
  })
  return graph.circular().map((chain) => chain.join(' > '))
}

function totals(counts) {
  const sum = Object.fromEntries(RULE_IDS.map((rule) => [rule, 0]))
  for (const perFile of Object.values(counts)) {
    for (const [rule, n] of Object.entries(perFile)) {
      sum[rule] += n
    }
  }
  return sum
}

// 基準より増えたファイルと規則
function regressions(baseline, counts) {
  const found = []
  for (const [file, perFile] of Object.entries(counts)) {
    for (const [rule, n] of Object.entries(perFile)) {
      const allowed = baseline.files[file]?.[rule] ?? 0
      if (n > allowed) {
        found.push({ file, rule, n, allowed })
      }
    }
  }
  return found
}

async function readBaseline() {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { files: {}, circular: 0 }
    }
    throw error
  }
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const [{ counts, details }, chains] = await Promise.all([lintCounts(), circularChains()])
  const sum = totals(counts)
  console.log('関数の長さ・複雑度:', Object.entries(sum).map(([rule, n]) => `${rule}=${n}`).join(' '))
  console.log(`循環依存 (生成物を除く): ${chains.length} 本`)

  if (args.has('--list')) {
    for (const d of details) {
      console.log(`${d.file}:${d.line} [${d.rule}] ${d.message}`)
    }
    for (const chain of chains) {
      console.log(`循環: ${chain}`)
    }
  }

  if (args.has('--update')) {
    const files = sortedObject(Object.fromEntries(Object.entries(counts).map(([f, c]) => [f, sortedObject(c)])))
    await writeFile(BASELINE_PATH, `${JSON.stringify({ circular: chains.length, totals: sum, files }, null, 2)}\n`)
    console.log(`基準を書き直した: ${relative(ROOT, BASELINE_PATH)}`)
    return
  }

  const baseline = await readBaseline()
  const worse = regressions(baseline, counts)
  const failures = []
  for (const w of worse) {
    failures.push(`${w.file} の ${w.rule} が ${w.allowed} → ${w.n} 件に増えた`)
    for (const d of details.filter((x) => x.file === w.file && x.rule === w.rule)) {
      failures.push(`    ${d.file}:${d.line} ${d.message}`)
    }
  }
  if (chains.length > baseline.circular) {
    failures.push(`循環依存が ${baseline.circular} → ${chains.length} 本に増えた`)
    failures.push(...chains.map((chain) => `    ${chain}`))
  }
  if (failures.length > 0) {
    console.error(failures.join('\n'))
    console.error('長い関数は分けて短くする。直して減らしたときは `node scripts/checkComplexity.mjs --update` で基準を書き直す')
    process.exit(1)
  }
  const improved = Object.entries(baseline.files).some(([file, perFile]) =>
    Object.entries(perFile).some(([rule, n]) => (counts[file]?.[rule] ?? 0) < n),
  )
  if (improved || chains.length < baseline.circular) {
    console.log('基準より減った所がある。`--update` で基準を書き直すと、減った分が固定される')
  }
  console.log('OK')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
