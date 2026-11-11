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

// 境界を引き切って離すと (フォルダーは 2 文字以下、上下のペインは 2 行以下)、狭くなった側の
// ペインを隠して構成を減らす。タブのダブルクリックでも隠す (docs/86 §4-19)。
// 引き切っている間はタブの色が変わる (data-collapse)
test.describe('境界の引き切りでペインを隠す', () => {
  const panesShown = (page: Page) => page.locator('[data-panes]').getAttribute('data-panes')

  async function dragTabTo(page: Page, separator: Locator, to: { x?: number; y?: number }): Promise<void> {
    const tab = (await separator.locator('[data-pane-resizer-tab]').boundingBox())!
    const from = { x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x ?? from.x, to.y ?? from.y, { steps: 8 })
  }

  test('3 ペインでフォルダーを左へ引き切ると、フォルダーを隠して 2 ペイン', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await openWithPanes(page, '3')
    const separator = page.getByRole('separator', { name: 'フォルダーの幅' })
    const before = Number(await separator.getAttribute('aria-valuenow'))

    await dragTabTo(page, separator, { x: 20 })
    await expect(separator).toHaveAttribute('data-collapse', 'folder')
    await page.mouse.up()

    await expect.poll(() => panesShown(page)).toBe('2')
    await expect(separator).toHaveCount(0)
    // 寸法は掴む前のまま (次に 3 ペインへ戻したとき端に張り付かない)
    expect(await page.evaluate(() => localStorage.getItem('pane-folder-w'))).toBe(String(before))
  })

  test('2 ペインで下のペインを下へ引き切ると、下を閉じて 1 ペイン (日の一覧も出直さない)', async ({ page }) => {
    await openWithPanes(page, '2')
    const dayPane = page.getByRole('region', { name: '11月5日 (木) の予定' })
    await expect(dayPane).toBeVisible()
    const separator = page.getByRole('separator', { name: 'プレビューの高さ' }).last()

    await dragTabTo(page, separator, { y: page.viewportSize()!.height - 5 })
    await expect(separator).toHaveAttribute('data-collapse', 'preview')
    await page.mouse.up()

    await expect.poll(() => panesShown(page)).toBe('1')
    await expect(dayPane).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '11月5日 (木) の予定' })).toHaveCount(0)
  })

  test('2 ペインで上の一覧を上へ引き切ると、一覧側を隠して 1 ペイン (日の一覧は浮かせて残る)', async ({ page }) => {
    await openWithPanes(page, '2')
    const separator = page.getByRole('separator', { name: 'プレビューの高さ' }).last()

    await dragTabTo(page, separator, { y: 5 })
    await expect(separator).toHaveAttribute('data-collapse', 'results')
    await page.mouse.up()

    await expect.poll(() => panesShown(page)).toBe('1')
    await expect(page.getByRole('dialog', { name: '11月5日 (木) の予定' })).toBeVisible()
  })

  test('3 ペインでも一覧とノートの境界を下へ引き切ると、下を閉じて 1 ペイン', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await openWithPanes(page, '3')
    const separator = page.getByRole('separator', { name: 'プレビューの高さ' }).last()

    await dragTabTo(page, separator, { y: page.viewportSize()!.height - 5 })
    await expect(separator).toHaveAttribute('data-collapse', 'preview')
    await page.mouse.up()

    await expect.poll(() => panesShown(page)).toBe('1')
    await expect(page.getByRole('region', { name: '11月5日 (木) の予定' })).toHaveCount(0)
  })

  test('タブのダブルクリックで隠す (フォルダーの境界はフォルダー、一覧とノートの境界は下のペイン)', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await openWithPanes(page, '3')
    await page.getByRole('separator', { name: 'フォルダーの幅' }).locator('[data-pane-resizer-tab]').dblclick()
    await expect.poll(() => panesShown(page)).toBe('2')

    // 2 ペインで日を選び直して、下のペインの境界をダブルクリック
    await page.locator('[data-search-results] [data-calendar] [data-day="2026-11-05"]').click()
    const dayPane = page.getByRole('region', { name: '11月5日 (木) の予定' })
    await expect(dayPane).toBeVisible()
    await page.getByRole('separator', { name: 'プレビューの高さ' }).last().locator('[data-pane-resizer-tab]').dblclick()
    await expect.poll(() => panesShown(page)).toBe('1')
    await expect(dayPane).toHaveCount(0)
  })

  test('フォルダーは 2 文字の幅より太いうちは隠さない (端で止まるだけ)', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await openWithPanes(page, '3')
    const separator = page.getByRole('separator', { name: 'フォルダーの幅' })
    // 6rem (96px)。下限 9rem は越えるが、隠す 2rem までは届かない
    await dragTabTo(page, separator, { x: 96 })
    await expect(separator).not.toHaveAttribute('data-collapse')
    await page.mouse.up()
    await expect.poll(() => panesShown(page)).toBe('3')
    await expect(separator).toHaveAttribute('aria-valuenow', '9')
  })

  test('下のペインは 2 行より高いうちは隠さない (端で止まるだけ)', async ({ page }) => {
    await openWithPanes(page, '2')
    const separator = page.getByRole('separator', { name: 'プレビューの高さ' }).last()
    const height = page.viewportSize()!.height
    const bar = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottom-bar-h')),
    )
    // 下のペインが 16dvh (下限 20 を越えるが、隠す 2 行までは届かない)
    await dragTabTo(page, separator, { y: height - bar - height * 0.16 })
    await expect(separator).not.toHaveAttribute('data-collapse')
    await page.mouse.up()
    await expect.poll(() => panesShown(page)).toBe('2')
    await expect(separator).toHaveAttribute('aria-valuenow', '20')
  })
})
