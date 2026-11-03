import type { Locator, Page } from '@playwright/test'
import { BASE_URL } from './env'
import { closePage, expect, expectHydrated, newLoggedInPage, selectNoteTab, test } from './helpers'
import { e2eNote, removeE2eNote, searchResults } from './notes'

// 予定カレンダー (docs/126): 月を開く → 日を選ぶ (2 ペインは下のペインに一覧) →
// 「+」・予定を押すと行のそばにフォーム → 時刻を直すと本文の行だけ変わる。
//
// 「+」は押すたびに新しい番号を振るので、作った予定を E2E の門番 (id の頭) で
// 消せない。そこで「+」はフォームが出ること (日付) を確かめるだけにし、保存は
// E2E の固定 id のノートの「予定」タブで行う (ClientNotePane が受ける)
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

// 浮かせた一覧はマスの右か左に接し、画面の中に収まる
async function expectBesideCell(page: Page, popover: Locator): Promise<void> {
  const cell = await dayCell(page, DAY).boundingBox()
  const box = await popover.boundingBox()
  const viewport = page.viewportSize()
  if (cell === null || box === null || viewport === null) {
    throw new Error('位置を測れない')
  }
  const touchesRight = Math.abs(box.x - (cell.x + cell.width)) <= 6
  const touchesLeft = Math.abs(box.x + box.width - cell.x) <= 6
  expect(touchesRight || touchesLeft).toBe(true)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
}

function dayPane(page: Page): Locator {
  return page.getByRole('region', { name: '11月5日 (木) の予定' })
}

function noteHref(extra = ''): string {
  return `/item/${NOTE.id}?q=${encodeURIComponent(QUERY)}&cal=${MONTH}${extra}`
}

async function openCalendar(page: Page, panes: '1' | '2' = '2'): Promise<void> {
  // 2 ペイン (検索結果 + ノート)。選んだ日はノートのペインの場所に出る
  await page.context().addCookies([{ name: 'panes', value: panes, url: BASE_URL }])
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

  test('日を選ぶと下のペインに一覧が出て、「+」で行のそばにフォームが出る', async ({ page }) => {
    await openCalendar(page)

    await dayCell(page, DAY).click()
    // body へ portal するので page から引く
    const pane = dayPane(page)
    await expect(pane.getByText('予定はありません')).toBeVisible()
    // ノートのペインの場所 (マス目より下)
    const cell = await dayCell(page, DAY).boundingBox()
    const paneBox = await pane.boundingBox()
    expect(paneBox!.y).toBeGreaterThan(cell!.y)

    await pane.getByRole('button', { name: '予定を追加' }).click()
    const dialog = page.getByRole('dialog', { name: '予定を追加' })
    await expect(dialog.getByRole('button', { name: '追加' })).toBeVisible()
    await expect(dialog.getByLabel('日付')).toHaveValue(DAY)
    // Esc はフォームだけを閉じる
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(pane).toBeVisible()
    await pane.getByRole('button', { name: '閉じる' }).click()
    await expect(pane).toHaveCount(0)

    // 固定 id のノートの予定タブで保存する
    await page.evaluate((url) => window.history.pushState(null, '', url), noteHref(`&tab=event&date=${DAY}`))
    const form = page.getByRole('form', { name: '予定' })
    await expect(form.getByRole('button', { name: '追加' })).toBeVisible()
    await expect(form.getByLabel('日付')).toHaveValue(DAY)
    await form.getByLabel('題名').fill(NOTE.heading)
    await form.getByLabel('終日').uncheck()
    await form.getByLabel('開始').fill('10:00')
    await form.getByLabel('終了 (省略で 1 時間)').fill('11:00')
    await form.getByRole('button', { name: '追加' }).click()
    await expect(form.getByText('保存しました')).toBeVisible()

    // 月に出る (控えを古くして取り直す)
    await expect(dayCell(page, DAY)).toContainText(NOTE.heading)
    await dayCell(page, DAY).click()
    await expect(pane.getByRole('button', { name: new RegExp(NOTE.key) })).toContainText('10:00')
  })

  test('予定を押すと行のそばにフォームが出て、時刻を直すと本文の行だけ変わる', async ({ page }) => {
    await openCalendar(page)
    await dayCell(page, DAY).click()
    const pane = dayPane(page)
    const row = pane.getByRole('button', { name: new RegExp(NOTE.key) })
    await row.click()

    const dialog = page.getByRole('dialog', { name: '予定を直す' })
    const form = dialog.getByRole('form', { name: '予定' })
    await expect(form.getByLabel('題名')).toHaveValue(NOTE.heading)
    await expect(form.getByLabel('開始')).toHaveValue('10:00')
    // 行のすぐ上か下に出る
    const rowBox = await row.boundingBox()
    const box = await dialog.boundingBox()
    const above = Math.abs(box!.y + box!.height - rowBox!.y) <= 6
    const below = Math.abs(box!.y - (rowBox!.y + rowBox!.height)) <= 6
    expect(above || below).toBe(true)

    await form.getByLabel('開始').fill('13:00')
    await form.getByLabel('終了 (省略で 1 時間)').fill('14:30')
    await form.getByRole('button', { name: '保存' }).click()
    // 保存したら閉じ、一覧が新しい時刻になる
    await expect(dialog).toHaveCount(0)
    await expect(row).toContainText('13:00')
    await page.keyboard.press('Escape')
    await expect(pane).toHaveCount(0)

    // 本文は決まった所だけ変わる (タグの行は残る)
    await page.evaluate((url) => window.history.pushState(null, '', url), noteHref())
    await selectNoteTab(page, 'テキスト')
    const text = page.locator('pre').filter({ hasText: NOTE.heading })
    await expect(text).toContainText(`#${TAG}`)
    await expect(text).toContainText(`date=${DAY} start=13:00 end=14:30`)
  })

  test('1 ペインでは日の一覧をマスの横に浮かせる', async ({ page }) => {
    await openCalendar(page, '1')
    await dayCell(page, DAY).click()
    const popover = page.getByRole('dialog', { name: '11月5日 (木) の予定' })
    await expect(popover.getByRole('link', { name: new RegExp(NOTE.key) })).toContainText('13:00')
    await expectBesideCell(page, popover)
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
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
