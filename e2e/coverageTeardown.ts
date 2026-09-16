import { CoverageReport } from 'monocart-coverage-reports'
import { E2E_COVERAGE_OPTIONS } from './coverageOptions'

// E2E_COVERAGE=1 のときの globalTeardown。fixture が積んだ V8 カバレッジを
// ソースマップで元の .ts / .tsx に戻し、istanbul の JSON (coverage-e2e/
// coverage-final.json) に書き出す。vitest との合算は scripts/coverageMerge.ts
export default async function coverageTeardown(): Promise<void> {
  await new CoverageReport(E2E_COVERAGE_OPTIONS).generate()
}
