import path from 'node:path'
import type { CoverageReportOptions } from 'monocart-coverage-reports'

// E2E のカバレッジ (docs/96 §11) の置き場と、monocart に渡す設定。
//
// fixture (coverage.ts)・globalSetup / globalTeardown・合算の scripts/coverageMerge.ts
// が同じものを読む。`@playwright/test` の test を import しない葉に置く (env.ts と同じ理由)

// E2E_COVERAGE=1 のときだけ集める。ふだんの E2E は遅くしない
export function isE2eCoverageEnabled(): boolean {
  return process.env.E2E_COVERAGE === '1'
}

export const ROOT = path.resolve(__dirname, '..')

// vitest の結果 (vitest.config.ts の reportsDirectory)。vitest は走るたびに
// この置き場を消すので、E2E の置き場は別にする
export const UNIT_COVERAGE_JSON = path.join(ROOT, 'coverage', 'coverage-final.json')
export const E2E_COVERAGE_DIR = path.join(ROOT, 'coverage-e2e')
export const E2E_COVERAGE_JSON = path.join(E2E_COVERAGE_DIR, 'coverage-final.json')
export const MERGED_COVERAGE_DIR = path.join(ROOT, 'coverage-merged')

// dev サーバ (Turbopack) が配るクライアントのチャンク
const APP_CHUNK = '/_next/static/chunks/'

// ソースマップを持つチャンクだけを数える。持たないもの (チャンクの一覧を
// 並べるだけのファイル) は元のソースに戻せず、チャンクのまま報告に混ざる
const SOURCE_MAP_COMMENT = /\n\/\/# sourceMappingURL=\S+\s*$/

// monocart はソースマップの sources (file:///…/src/…) を作業ディレクトリからの
// 相対パス (src/…) にしてから、この filter に通す。vitest の include / exclude
// (vitest.config.ts) と同じ範囲に絞る
const APP_SOURCE = /^src\/.+\.tsx?$/
const NOT_APP_SOURCE = /\.test\.tsx?$|^src\/(?:generated|types|test)\//

export const E2E_COVERAGE_OPTIONS: CoverageReportOptions = {
  name: 'E2E のカバレッジ',
  outputDir: E2E_COVERAGE_DIR,
  logging: 'error',
  entryFilter: (entry) =>
    entry.url.includes(APP_CHUNK) && SOURCE_MAP_COMMENT.test(entry.source ?? ''),
  sourceFilter: (sourcePath) =>
    APP_SOURCE.test(sourcePath) && !NOT_APP_SOURCE.test(sourcePath),
  reports: [
    ['json', { file: 'coverage-final.json' }],
    ['console-summary'],
  ],
}
