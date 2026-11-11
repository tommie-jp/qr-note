import { expect, test } from './helpers'

// ハンバーガーメニューの詰めた行と「スクロールバー」の設定 (docs/11 §6-8)

test.describe('メニューの行とスクロールバー', () => {
  test('行の高さは 24px で、行の間は空けない', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'メニュー', exact: true }).click()
    const github = page.getByRole('link', { name: 'GitHub' })
    await expect(github).toBeVisible()
    // シートの子 (行) を上から順に測る
    const rows = await github.evaluate((link) =>
      [...link.parentElement!.children].map((row) => {
        const box = row.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom, height: box.height }
      }),
    )
    // (つまみの飾り 4px と、説明文の入る複数行の行は除く)
    const singles = rows.filter((row) => row.height > 10 && row.height < 30)
    expect(singles.length).toBeGreaterThan(4)
    for (const row of singles) {
      expect(row.height).toBe(24)
    }
    // 行と行の間は空けない (先頭のつまみの飾りの下は除く)
    for (let i = 2; i < rows.length; i++) {
      expect(rows[i].top).toBeCloseTo(rows[i - 1].bottom, 0)
    }
  })

  test('既定はスクロールバーを隠し、メニューで出すと端末に覚える', async ({ page }) => {
    await page.goto('/')
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-scrollbars', 'hidden')
    const width = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth)
    expect(await width()).toBe('none')

    await page.getByRole('button', { name: 'メニュー', exact: true }).click()
    await page.getByRole('radio', { name: '出す' }).click()
    await expect(html).toHaveAttribute('data-scrollbars', 'shown')
    expect(await width()).toBe('auto')
    // シートは閉じない
    await expect(page.getByRole('radio', { name: '出す' })).toBeChecked()

    await page.reload()
    await expect(html).toHaveAttribute('data-scrollbars', 'shown')
  })
})
