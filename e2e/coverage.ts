import type { Page } from '@playwright/test'
import type { CoverageReport } from 'monocart-coverage-reports'
import { E2E_COVERAGE_OPTIONS, isE2eCoverageEnabled } from './coverageOptions'

// ページごとに Chromium の V8 カバレッジを取り、monocart のキャッシュ
// (coverage-e2e/.cache) へ足す (docs/96 §11)。E2E_COVERAGE=1 のときだけ動く。
// worker のプロセスが入れ替わっても同じ置き場に積まれ、globalTeardown
// (coverageTeardown.ts) が 1 つの報告にまとめる。
//
// monocart は数えるときだけ読み込む。helpers.ts 経由で全 spec がこのファイルを
// 読むので、静的に import するとふだんの E2E まで monocart に依存する

let report: Promise<CoverageReport> | undefined

function coverageReport(): Promise<CoverageReport> {
  report ??= import('monocart-coverage-reports').then(
    (mcr) => new mcr.CoverageReport(E2E_COVERAGE_OPTIONS),
  )
  return report
}

async function start(page: Page): Promise<void> {
  // 画面内の遷移 (クライアント側のルーティング) をまたいで数え続ける
  await page.coverage.startJSCoverage({ resetOnNavigation: false })
}

async function stopAndAdd(page: Page): Promise<void> {
  const entries = await page.coverage.stopJSCoverage()
  await (await coverageReport()).add(entries)
}

// **ハードナビゲーションの前に、それまでの分を回収して数え直す。**
// resetOnNavigation: false でも、前の文書のスクリプトは V8 が捨てるので
// 止めたときの結果に出てこない (goto を重ねる secrets.spec では設定画面や
// 閲覧画面の部品が丸ごと抜けた)。spec が呼ぶ goto / reload をこのページに限って
// 包む。アプリ自身が起こす再読込の前の分は取りこぼす
function flushBeforeNavigation(page: Page): void {
  const goto = page.goto.bind(page)
  const reload = page.reload.bind(page)
  page.goto = async (...args: Parameters<Page['goto']>) => {
    await stopAndAdd(page)
    await start(page)
    return goto(...args)
  }
  page.reload = async (...args: Parameters<Page['reload']>) => {
    await stopAndAdd(page)
    await start(page)
    return reload(...args)
  }
}

export async function startCoverage(page: Page): Promise<void> {
  if (!isE2eCoverageEnabled()) return
  await start(page)
  flushBeforeNavigation(page)
}

// 閉じる前に呼ぶ。閉じたページからは取れない
export async function collectCoverage(page: Page): Promise<void> {
  if (!isE2eCoverageEnabled() || page.isClosed()) return
  await stopAndAdd(page)
}
