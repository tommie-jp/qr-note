import type { Locator, Page } from '@playwright/test'
import { BASE_URL } from './env'
import { closePage, expect, expectHydrated, newLoggedInPage, selectNoteTab, test } from './helpers'
import { e2eNote, removeE2eNote, searchResults } from './notes'

// 予定カレンダー (docs/126): 月を開く → 日を選ぶ → 「+」で予定タブ →
// 題名と時刻を入れて追加 → 月に出る → 予定を押して時刻を直す → 本文の行だけ変わる。
//
// 「+」は押すたびに新しい番号を振るので、作った予定を E2E の門番 (id の頭) で
// 消せない。そこで「+」は行き先 (tab・date) を確かめるだけにし、保存は
// E2E の固定 id で同じ URL を端末で開いて行う (ClientNotePane が受ける)
const NOTE = e2eNote(41, `歯医者 ${Date.now() % 100000}`)
// 他の予定と混ざらないよう、このテストだけのタグで絞ったカレンダーを開く
const TAG = 'zze2ecal'
const QUERY = `#${TAG}`
const MONTH = '2026-11'
const DAY = '2026-11-05'

test.describe.configure({ mode: 'serial' })

function calendar(page: Page): Locator {
  return searchResults(page).locator('[data-calendar]')
}

function dayCell(page: Page, day: string): Locator {
  return calendar(page).locator(`[data-day="${day}"]`)
}

async function openCalendar(page: Page): Promise<void> {
  // 2 ペイン (検索結果 + ノート)。予定は右のペインで開く
  await page.context().addCookies([{ name: 'panes', value: '2', url: BASE_URL }])
  await page.goto(`/?q=${encodeURIComponent(QUERY)}&cal=${MONTH}`)
  await expect(calendar(page).getByRole('heading', { name: '2026年11月' })).toBeVisible()
  await expectHydrated(dayCell(page, DAY))
}

test.describe('予定カレンダー', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await closePage(page)
  })

  test.afterAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await closePage(page)
  })

  test('日を選んで予定を足すと月に出る', async ({ page }) => {
    await openCalendar(page)

    await dayCell(page, DAY).click()
    const strip = calendar(page).getByRole('region', { name: '11月5日 (木) の予定' })
    await expect(strip.getByText('予定はありません')).toBeVisible()

    // 「+」は新しい番号で予定タブを開く (保存はしない)
    await strip.getByRole('button', { name: '+ 予定を追加' }).click()
    await expect(page).toHaveURL(/\/item\/[0-9a-f-]{36}\?.*cal=2026-11.*tab=event.*date=2026-11-05/)
    await expect(page.getByRole('form', { name: '予定' }).getByRole('button', { name: '追加' })).toBeVisible()

    // 同じ行き先を E2E の固定 id で開き直して保存する
    const href = `/item/${NOTE.id}?q=${encodeURIComponent(QUERY)}&cal=${MONTH}&tab=event&date=${DAY}`
    await page.evaluate((url) => window.history.pushState(null, '', url), href)
    const form = page.getByRole('form', { name: '予定' })
    await expect(form.getByRole('button', { name: '追加' })).toBeVisible()
    await expect(form.getByLabel('日付')).toHaveValue(DAY)
    await form.getByLabel('題名').fill(NOTE.heading)
    await form.getByLabel('終日').uncheck()
    await form.getByLabel('開始').fill('10:00')
    await form.getByLabel('終了 (省略で 1 時間)').fill('11:00')
    await form.getByRole('button', { name: '追加' }).click()
    await expect(form.getByText('保存しました')).toBeVisible()

    // 左の月に出る (控えを古くして取り直す)
    await expect(dayCell(page, DAY)).toContainText(NOTE.heading)
    await expect(strip.getByRole('link', { name: new RegExp(NOTE.key) })).toContainText('10:00')
  })

  test('予定を押すと予定タブで開き、時刻を直すと本文の行だけ変わる', async ({ page }) => {
    await openCalendar(page)
    await dayCell(page, DAY).click()
    const strip = calendar(page).getByRole('region', { name: '11月5日 (木) の予定' })
    await strip.getByRole('link', { name: new RegExp(NOTE.key) }).click()

    const form = page.getByRole('form', { name: '予定' })
    await expect(form.getByLabel('題名')).toHaveValue(NOTE.heading)
    await expect(form.getByLabel('開始')).toHaveValue('10:00')
    await form.getByLabel('開始').fill('13:00')
    await form.getByLabel('終了 (省略で 1 時間)').fill('14:30')
    await form.getByRole('button', { name: '保存' }).click()
    await expect(form.getByText('保存しました')).toBeVisible()
    await expect(strip.getByRole('link', { name: new RegExp(NOTE.key) })).toContainText('13:00')

    // 本文は決まった所だけ変わる (タグの行は残る)
    await selectNoteTab(page, 'テキスト')
    const text = page.locator('pre').filter({ hasText: NOTE.heading })
    await expect(text).toContainText(`#${TAG}`)
    await expect(text).toContainText(`date=${DAY} start=13:00 end=14:30`)
  })

  test('「一覧」で一覧に戻り、ツールバーの「カレンダー」で戻れる', async ({ page }) => {
    await openCalendar(page)
    await calendar(page).getByRole('button', { name: '一覧', exact: true }).click()
    await expect(page).not.toHaveURL(/cal=/)
    await expect(searchResults(page).getByText(`「${QUERY}」の検索結果`)).toBeVisible()
    await searchResults(page).getByRole('button', { name: 'カレンダー' }).click()
    await expect(page).toHaveURL(/cal=\d{4}-\d{2}/)
    await expect(calendar(page)).toBeVisible()
  })
})
