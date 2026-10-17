import type { Page } from '@playwright/test'
import { closePage, expect, newLoggedInPage, test } from './helpers'

// メニューの「スキャン音」(docs/112-スキャン音量計画.md)。
//
// - 段送りで段が変わり、押してもシートが閉じないこと
// - 段を端末に覚え、読み込み直しても同じ段で開くこと
// - 押すたびに試し鳴りし、消音では鳴らさないこと
//
// **音そのものは聞かない。** HTMLMediaElement.play を差し替え、鳴らそうと
// した音源 (data URI) を数えるだけにする。実際の音量は iPhone 実機で確かめる
const STORAGE_KEY = 'qr-search:scan-beep-volume'

interface PlayLog {
  __scanBeepPlays?: string[]
}

async function openMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'メニュー', exact: true }).click()
  await expect(page.getByText('スキャン音', { exact: true })).toBeVisible()
}

function plays(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as PlayLog).__scanBeepPlays ?? [])
}

test.describe('メニューのスキャン音', () => {
  let page: Page

  test.beforeEach(async ({ browser }) => {
    page = await newLoggedInPage(browser)
    await page.addInitScript(() => {
      const log: string[] = []
      ;(window as PlayLog).__scanBeepPlays = log
      HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
        log.push(this.src)
        return Promise.resolve()
      }
    })
    await page.goto('/')
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY)
    await page.reload()
  })

  test.afterEach(async () => {
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY)
    await closePage(page)
  })

  test('段送りで段が変わり、シートは開いたまま、段を覚える', async () => {
    await openMenu(page)
    const lower = page.getByRole('button', { name: 'スキャン音を小さく', exact: true })
    const raise = page.getByRole('button', { name: 'スキャン音を大きく', exact: true })

    // 既定は「大」(上の端)
    await expect(page.getByRole('button', { name: '大。押すと大に戻す' })).toBeVisible()
    await expect(raise).toBeDisabled()

    await lower.click()
    await expect(page.getByRole('button', { name: '中。押すと大に戻す' })).toBeVisible()
    // 押してもシートが閉じない (続けて押し比べられる)
    await lower.click()
    await expect(page.getByRole('button', { name: '小。押すと大に戻す' })).toBeVisible()

    const played = await plays(page)
    expect(played).toHaveLength(2)
    expect(played.every((src) => src.startsWith('data:audio/wav;base64,'))).toBe(true)
    // 段が違えば音源 (振幅) も違う
    expect(played[0]).not.toBe(played[1])

    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('low')

    await page.reload()
    await openMenu(page)
    await expect(page.getByRole('button', { name: '小。押すと大に戻す' })).toBeVisible()
  })

  test('消音では試し鳴りせず、段の名前を押すと大に戻る', async () => {
    await openMenu(page)
    const lower = page.getByRole('button', { name: 'スキャン音を小さく', exact: true })
    for (let i = 0; i < 3; i++) {
      await lower.click()
    }
    await expect(page.getByRole('button', { name: '消音。押すと大に戻す' })).toBeVisible()
    await expect(lower).toBeDisabled()
    // 中・小は鳴らし、消音は鳴らさない
    expect(await plays(page)).toHaveLength(2)

    await page.getByRole('button', { name: '消音。押すと大に戻す' }).click()
    await expect(page.getByRole('button', { name: '大。押すと大に戻す' })).toBeVisible()
    expect(await plays(page)).toHaveLength(3)
  })
})
