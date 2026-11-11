import type { Locator, Page } from '@playwright/test'
import { BASE_URL } from './env'
import { expect, expectHydrated, test } from './helpers'

// ペインの境界の中央のつまみ (タブ)。帯 (8px) だけでは掴みにくいので、線の中央に
// 横の境界は ⋯、縦の境界は ︙ のタブを重ねた (components/panes/PaneResizer.tsx)。
// タブを掴めること = **帯の外でタブの中だけに当たる点**を押しても寸法が変わること、を確かめる

// 予定の無いタグで開くカレンダー。日を押すと下のペイン (と横の境界) が出る
const QUERY = '#zze2epanetab'
const MONTH = '2026-11'

async function openWithPanes(page: Page, panes: '2' | '3'): Promise<void> {
  await page.context().addCookies([{ name: 'panes', value: panes, url: BASE_URL }])
  await page.goto(`/?q=${encodeURIComponent(QUERY)}&cal=${MONTH}`)
  const cell = page.locator('[data-search-results] [data-calendar] [data-day="2026-11-05"]')
  await expectHydrated(cell)
  await cell.click()
}

// 帯の線から離れた、タブの端寄りの点 (帯は線の両側 4px なので、それより外)
async function pointOnTabOnly(separator: Locator, axis: 'x' | 'y'): Promise<{ x: number; y: number }> {
  const band = (await separator.boundingBox())!
  const tab = (await separator.locator('[data-pane-resizer-tab]').boundingBox())!
  const point = axis === 'y' ? { x: tab.x + tab.width / 2, y: tab.y + 2 } : { x: tab.x + 2, y: tab.y + tab.height / 2 }
  // 帯の外であること
  if (axis === 'y') {
    expect(point.y).toBeLessThan(band.y)
  } else {
    expect(point.x).toBeLessThan(band.x)
  }
  return point
}

async function dragFrom(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 })
  await page.mouse.up()
}

test.describe('ペインの境界のつまみ', () => {
  test('横の境界は ⋯ のタブで、帯の外のタブの端を掴んでも高さを変えられる', async ({ page }) => {
    await openWithPanes(page, '2')
    const separator = page.getByRole('separator', { name: 'プレビューの高さ' }).last()
    const tab = separator.locator('[data-pane-resizer-tab]')
    await expect(tab).toHaveText('⋯')
    const before = Number(await separator.getAttribute('aria-valuenow'))

    await dragFrom(page, await pointOnTabOnly(separator, 'y'), 0, -120)

    await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(before)
  })

  test('縦の境界 (フォルダー) は ︙ のタブで、帯の外のタブの端を掴んでも幅を変えられる', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await openWithPanes(page, '3')
    const separator = page.getByRole('separator', { name: 'フォルダーの幅' })
    const tab = separator.locator('[data-pane-resizer-tab]')
    await expect(tab).toHaveText('︙')
    const before = Number(await separator.getAttribute('aria-valuenow'))

    await dragFrom(page, await pointOnTabOnly(separator, 'x'), 80, 0)

    await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(before)
  })
})
