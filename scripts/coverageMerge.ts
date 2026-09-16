// 単体テスト (vitest) と E2E (Playwright) のカバレッジを合算する (docs/96 §11)。
//
// 画面部品は SSR の文字列テストでは effect もイベントも通らないので、単体だけ
// では低く出る。ブラウザで実際に動いた行 (E2E) を足して数え直す。
//
//   npm run test:coverage                                  → coverage/coverage-final.json
//   E2E_COVERAGE=1 E2E_START_SERVER=1 E2E_DATABASE_URL=… npm run test:e2e
//                                                          → coverage-e2e/coverage-final.json
//   npm run coverage:merge                                 → coverage-merged/ (html と表)
//
// 行の数え方は istanbul と同じ (文の先頭行ごとに、最も多い実行回数を取る)。
// 単体と E2E は変換器が違い、同じ行でも文の位置がずれることがある。istanbul の
// 合算は位置で突き合わせるので、片方にしか無い文も残る (分母が少し膨らむ側に倒れる)
import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { CoverageReport } from 'monocart-coverage-reports'
import {
  E2E_COVERAGE_JSON,
  MERGED_COVERAGE_DIR,
  ROOT,
  UNIT_COVERAGE_JSON,
} from '../e2e/coverageOptions'

interface Location {
  readonly start: { readonly line: number }
}

interface FileCoverage {
  readonly path: string
  readonly statementMap: Readonly<Record<string, Location>>
  readonly s: Readonly<Record<string, number>>
}

type CoverageJson = Readonly<Record<string, FileCoverage>>

// 表に出す置き場 (docs/96 §10 の目標は画面部品の 2 つ)
const REPORTED_DIRS = [
  'src/components/draw',
  'src/components/secret',
  'src/components',
  'src',
] as const

const MERGED_JSON = path.join(MERGED_COVERAGE_DIR, 'coverage-final.json')

async function readCoverage(file: string, hint: string): Promise<CoverageJson> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    throw new Error(`${path.relative(ROOT, file)} が無い。先に ${hint} を流す`)
  }
  return JSON.parse(text) as CoverageJson
}

// vitest は絶対パス、monocart は作業ディレクトリからの相対パスを鍵にする。
// 同じファイルが 1 つに合わさるよう絶対パスへ揃える
function withAbsolutePaths(json: CoverageJson): CoverageJson {
  return Object.fromEntries(
    Object.entries(json).map(([key, file]) => {
      const absolute = path.resolve(ROOT, key)
      return [absolute, { ...file, path: absolute }]
    }),
  )
}

function lineHits(file: FileCoverage): Map<number, number> {
  const lines = new Map<number, number>()
  for (const [id, location] of Object.entries(file.statementMap)) {
    const line = location.start.line
    const hits = file.s[id] ?? 0
    lines.set(line, Math.max(lines.get(line) ?? 0, hits))
  }
  return lines
}

interface LineSummary {
  readonly covered: number
  readonly total: number
}

function summarizeDir(json: CoverageJson, dir: string): LineSummary {
  const prefix = path.join(ROOT, dir) + path.sep
  let covered = 0
  let total = 0
  for (const [file, coverage] of Object.entries(json)) {
    if (!file.startsWith(prefix)) continue
    for (const hits of lineHits(coverage).values()) {
      total += 1
      if (hits > 0) covered += 1
    }
  }
  return { covered, total }
}

function percent({ covered, total }: LineSummary): string {
  if (total === 0) return '-'
  return `${((covered / total) * 100).toFixed(1)}% (${covered}/${total})`
}

async function mergeCoverage(
  unit: CoverageJson,
  e2e: CoverageJson,
): Promise<CoverageJson> {
  const report = new CoverageReport({
    name: '単体 + E2E のカバレッジ',
    outputDir: MERGED_COVERAGE_DIR,
    logging: 'error',
    // add したデータは .cache に積まれ、generate は置き場ごと読む。前の回の
    // 合算が混ざらないよう、始めに捨てる
    cleanCache: true,
    reports: [['json', { file: 'coverage-final.json' }], ['html']],
  })
  // istanbul の合算は渡したオブジェクトを書き換える。表の「単体」「E2E」が
  // 合算後の値にならないよう、複製を渡す
  await report.add(structuredClone(unit))
  await report.add(structuredClone(e2e))
  await report.generate()
  return readCoverage(MERGED_JSON, 'coverage:merge')
}

interface Row {
  readonly dir: string
  readonly unit: string
  readonly e2e: string
  readonly merged: string
}

// GitHub Actions のジョブのサマリ (GITHUB_STEP_SUMMARY) に表を足す
async function appendStepSummary(file: string, rows: readonly Row[]): Promise<void> {
  const lines = [
    '### 行カバレッジ (単体 + E2E)',
    '',
    '| 置き場 | 単体 | E2E | 合算 |',
    '| --- | --- | --- | --- |',
    ...rows.map((row) => `| \`${row.dir}\` | ${row.unit} | ${row.e2e} | ${row.merged} |`),
    '',
  ]
  await appendFile(file, lines.join('\n'))
}

async function main(): Promise<void> {
  const unit = withAbsolutePaths(
    await readCoverage(UNIT_COVERAGE_JSON, 'npm run test:coverage'),
  )
  const e2e = withAbsolutePaths(
    await readCoverage(E2E_COVERAGE_JSON, 'E2E_COVERAGE=1 npm run test:e2e'),
  )
  const merged = withAbsolutePaths(await mergeCoverage(unit, e2e))

  const rows: Row[] = REPORTED_DIRS.map((dir) => ({
    dir,
    unit: percent(summarizeDir(unit, dir)),
    e2e: percent(summarizeDir(e2e, dir)),
    merged: percent(summarizeDir(merged, dir)),
  }))
  console.table(
    Object.fromEntries(
      rows.map((row) => [row.dir, { 単体: row.unit, E2E: row.e2e, 合算: row.merged }]),
    ),
  )
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  if (summaryFile) {
    await appendStepSummary(summaryFile, rows)
  }
  console.log(`行ごとの内訳: ${path.relative(ROOT, MERGED_COVERAGE_DIR)}/index.html`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
