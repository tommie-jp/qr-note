import { CoverageReport } from 'monocart-coverage-reports'
import { E2E_COVERAGE_OPTIONS } from './coverageOptions'

// E2E_COVERAGE=1 のときの globalSetup。前の回のキャッシュを捨てて数え直す
export default function coverageSetup(): void {
  new CoverageReport(E2E_COVERAGE_OPTIONS).cleanCache()
}
