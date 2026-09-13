import { E2E_ITEM_PREFIX } from './env'
import {
  expect,
  hasHorizontalScroll,
  searchBox,
  searchFor,
  test,
} from './helpers'
import { searchResults } from './notes'

// 検索画面のスモーク。ノートの中身 (私的なデータ) には触れず、画面の骨組みと
// 検索の往復だけを見る

// iPhone SE (320px) と iPhone の標準幅 (375px)。verify skill が数値で確かめる 2 幅
const PHONE_WIDTHS = [320, 375] as const
const PHONE_HEIGHT = 812

test.describe('検索画面', () => {
  test.use({ viewport: { width: 375, height: PHONE_HEIGHT } })

  for (const width of PHONE_WIDTHS) {
    test(`ログイン済みで開くと帯と検索窓が出て、${width}px 幅で横スクロールしない`, async ({
      page,
    }) => {
      // Arrange
      await page.setViewportSize({ width, height: PHONE_HEIGHT })

      // Act
      await page.goto('/')

      // Assert
      await expect(page.getByRole('banner')).toBeVisible()
      await expect(searchBox(page)).toBeVisible()
      // 結果は Suspense で後から差し込まれる。出揃ってから幅を測る
      await expect(searchResults(page)).toBeVisible()
      expect(await hasHorizontalScroll(page)).toBe(false)
    })
  }

  test('打ち込むと URL の ?q= が変わり、結果の器が出る', async ({ page }) => {
    // Arrange
    // E2E の番号の頭 + 存在しない語。本物のノートを一覧に出さない
    const query = `${E2E_ITEM_PREFIX}-probe`
    await page.goto('/')

    // Act
    await searchFor(page, query)

    // Assert
    const results = searchResults(page)
    await expect(results.getByText(`「${query}」の検索結果`)).toBeVisible()
    await expect(results).toHaveAttribute('aria-busy', 'false')
    expect(await hasHorizontalScroll(page)).toBe(false)
  })
})
