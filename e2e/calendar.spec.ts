import type { Locator, Page } from '@playwright/test'
import { BASE_URL } from './env'
import { closePage, expect, expectHydrated, newLoggedInPage, selectNoteTab, test } from './helpers'
import { e2eNote, removeE2eNote, searchResults } from './notes'

// 予定カレンダー (docs/126、月曜始まり): 月を開く → 日を選ぶ (2 ペインは下のペインに一覧) →
// 「+」・予定を押すと行のそばにフォーム → 時刻を直すと本文の行だけ変わる。
//
// 「+」は押すたびに新しい番号を振るので、作った予定を E2E の門番 (id の頭) で
// 消せない。そこで「+」はフォームが出ること (日付) を確かめるだけにし、保存は
// E2E の固定 id のノートの「予定」タブで行う (ClientNotePane が受ける)
const NOTE = e2eNote(41, `歯医者 ${Date.now() % 100000}`)
// 並べ替えのテストの 2 件目 (同じ日の 10:00)
const NOTE2 = e2eNote(46, `眼科 ${Date.now() % 100000}`)
// 他の予定と混ざらないよう、このテストだけのタグで絞ったカレンダーを開く
const TAG = 'zze2ecal'
const QUERY = `#${TAG}`
const MONTH = '2026-11'
const DEFAULT_PREFS = {
  dateSize: 'md',
  eventSize: 'md',
  sidePadding: 'md',
  eventsPerDay: 5,
  colors: { high: '#fecaca', normal: '#fed7aa', low: '#bbf7d0' },
  textColors: { high: 'auto', normal: 'auto', low: 'auto' },
}
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

// 日のペインの予定の行 (押すとフォーム)。「済み」の釦も題名を名に持つので分ける
function eventRow(pane: Locator): Locator {
  return pane.locator('button[aria-haspopup="dialog"]', { hasText: NOTE.key })
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
    await removeE2eNote(page, NOTE2)
    await closePage(page)
  })

  test.afterAll(async ({ browser }) => {
    const page = await newLoggedInPage(browser)
    await removeE2eNote(page, NOTE)
    await removeE2eNote(page, NOTE2)
    // 設定のテストが途中で落ちても既定へ戻す
    await page.request.put('/api/calendar/settings', { data: DEFAULT_PREFS })
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
    await expect(eventRow(pane)).toContainText('10:00')
  })

  test('予定を押すと行のそばにフォームが出て、時刻を直すと本文の行だけ変わる', async ({ page }) => {
    await openCalendar(page)
    await dayCell(page, DAY).click()
    const pane = dayPane(page)
    const row = eventRow(pane)
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

  test('「済み」を押すと取り消し線が付き、本文に done= が入る。押し直すと戻る', async ({ page }) => {
    await openCalendar(page)
    await dayCell(page, DAY).click()
    const pane = dayPane(page)
    const done = pane.getByRole('button', { name: new RegExp(`${NOTE.key}.* を済みにする`) })
    // 日付の右に済みでない数 (この日の予定はこの 1 件。docs/126 §1-21)
    const progress = dayCell(page, DAY).locator('[data-day-progress]')
    await expect(progress).toHaveAttribute('data-day-progress', 'left')
    await expect(progress).toHaveText('残1')
    // 予定の題名ははみ出しても「…」を付けない (docs/126 §1-22)
    await expect(dayCell(page, DAY).locator('[data-priority]').first()).toHaveCSS('text-overflow', 'clip')

    await done.click()
    const undo = pane.getByRole('button', { name: new RegExp(`${NOTE.key}.* を未済に戻す`) })
    await expect(undo).toHaveAttribute('aria-pressed', 'true')
    await expect(eventRow(pane).locator('.line-through')).toBeVisible()
    // マス目も取り消し線 (月の予定を取り直した後)
    await expect(dayCell(page, DAY).locator('.line-through')).toContainText(NOTE.key)
    // すべて済みなので ✓
    await expect(progress).toHaveAttribute('data-day-progress', 'done')

    // 本文の予定の行に done= が入る
    const res = await page.request.get(`/api/items/${NOTE.id}`)
    expect(((await res.json()) as { data: { item: { memo: string } } }).data.item.memo).toMatch(
      /date=2026-11-05 start=13:00 end=14:30 done=\d{4}-\d{2}-\d{2}/,
    )

    await undo.click()
    await expect(done).toHaveAttribute('aria-pressed', 'false')
    await expect(dayCell(page, DAY).locator('.line-through')).toHaveCount(0)
    await expect(progress).toHaveText('残1')
    const after = await page.request.get(`/api/items/${NOTE.id}`)
    expect(((await after.json()) as { data: { item: { memo: string } } }).data.item.memo).not.toContain('done=')
  })

  test('月のマス目の高さは予定の数で変わらない', async ({ page }) => {
    await openCalendar(page)
    // 予定のある日 (DAY) と無い日は同じ高さ
    const withEvent = await dayCell(page, DAY).boundingBox()
    const empty = await dayCell(page, '2026-11-12').boundingBox()
    expect(withEvent!.height).toBe(empty!.height)
    // 予定を増やしても伸びない: マスの中身を 6 件ぶん水増しして測り直す
    await dayCell(page, DAY).evaluate((cell) => {
      for (let i = 0; i < 6; i++) {
        const chip = document.createElement('span')
        chip.className = 'truncate text-xs leading-4'
        chip.textContent = `予定 ${i}`
        cell.appendChild(chip)
      }
    })
    expect((await dayCell(page, DAY).boundingBox())!.height).toBe(withEvent!.height)
  })

  test('設定で 1 日の予定数 (マスの高さ) と月の左右の余白を変えられる', async ({ page }) => {
    await page.request.put('/api/calendar/settings', { data: DEFAULT_PREFS })
    await openCalendar(page)
    const grid = calendar(page).locator('[data-calendar-grid]')
    // 既定は 5 行: 25 + 21 × 5 = 130px
    expect((await dayCell(page, DAY).boundingBox())!.height).toBe(130)
    const widthMd = (await grid.boundingBox())!.width

    await calendar(page).getByRole('button', { name: 'カレンダーの設定' }).click()
    const panel = page.getByRole('dialog', { name: 'カレンダーの設定' })
    await panel.getByLabel('1 日に出す予定の数').selectOption('10')
    await expect.poll(async () => (await dayCell(page, DAY).boundingBox())!.height).toBe(235)
    await panel.getByRole('group', { name: '月の左右の余白' }).getByRole('button', { name: '0', exact: true }).click()
    // 左右 16px ずつ広がる (縦に送る器に切られない)
    await expect.poll(async () => (await grid.boundingBox())!.width).toBe(widthMd + 32)
    await panel.getByRole('group', { name: '月の左右の余白' }).getByRole('button', { name: '小', exact: true }).click()
    await expect.poll(async () => (await grid.boundingBox())!.width).toBe(widthMd + 16)
    await page.request.put('/api/calendar/settings', { data: DEFAULT_PREFS })
  })

  test('月の左右の余白はフォルダーペイン・日の一覧のペインにも効き、読み込み直しても残る', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.context().addCookies([{ name: 'panes', value: '3', url: BASE_URL }])
    await page.goto(`/?q=${encodeURIComponent(QUERY)}&cal=${MONTH}`)
    await expectHydrated(dayCell(page, DAY))
    const folder = page.locator('[data-folder-pane]')
    // 既定は中 (16px)
    await expect(folder).toHaveCSS('padding-left', '16px')

    await calendar(page).getByRole('button', { name: 'カレンダーの設定' }).click()
    const group = page.getByRole('dialog', { name: 'カレンダーの設定' }).getByRole('group', { name: '月の左右の余白' })
    await group.getByRole('button', { name: '0', exact: true }).click()
    await expect(folder).toHaveCSS('padding-left', '0px')
    await expect(folder).toHaveCSS('padding-right', '0px')
    // 日の一覧のペインも同じ余白 (docs/126 §1-25)
    await dayCell(page, DAY).click()
    const pane = dayPane(page)
    await expect(pane).toHaveCSS('padding-left', '0px')
    await expect(pane).toHaveCSS('padding-right', '0px')

    // 一覧表示に戻して読み込み直しても、先回りで当たる
    await page.goto(`/?q=${encodeURIComponent(QUERY)}`)
    await expect(page.locator('[data-folder-pane]')).toHaveCSS('padding-left', '0px')

    await page.goto(`/?q=${encodeURIComponent(QUERY)}&cal=${MONTH}`)
    // 動き出す前に押すと空振りする (設定の釦はまだ素の HTML)
    await expectHydrated(dayCell(page, DAY))
    await calendar(page).getByRole('button', { name: 'カレンダーの設定' }).click()
    await page
      .getByRole('dialog', { name: 'カレンダーの設定' })
      .getByRole('group', { name: '月の左右の余白' })
      .getByRole('button', { name: '中', exact: true })
      .click()
    await expect(page.locator('[data-folder-pane]')).toHaveCSS('padding-left', '16px')
  })

  for (const panes of ['1', '2'] as const) {
    test(`見出し行と曜日の行は送っても上端に残る (${panes} ペイン)`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 700 })
      await openCalendar(page, panes)
      const heading = calendar(page).getByRole('heading', { name: '2026年11月' })
      const weekday = calendar(page).locator('[data-calendar-head]').getByText('月', { exact: true })
      const before = { heading: (await heading.boundingBox())!.y, weekday: (await weekday.boundingBox())!.y }

      // 送るのは結果の器だけ (1 ペインでも画面全体は動かない)
      const scroller = page.locator('[data-results-scroll]')
      await scroller.evaluate((el) => el.scrollTo({ top: 400 }))
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
      expect(await page.evaluate(() => window.scrollY)).toBe(0)

      expect((await heading.boundingBox())!.y).toBeCloseTo(before.heading, 0)
      expect((await weekday.boundingBox())!.y).toBeCloseTo(before.weekday, 0)
      // 先頭の週のマスは見出しの下に潜っている
      const firstCell = (await dayCell(page, '2026-10-26').boundingBox())!
      expect(firstCell.y).toBeLessThan(before.weekday)
    })
  }

  test('狭い画面では見出しの釦を横に送れ、設定のアイコンは動かない', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await openCalendar(page, '1')
    const nav = calendar(page).locator('[data-calendar-nav]')
    const settings = calendar(page).getByRole('button', { name: 'カレンダーの設定' })
    const before = (await settings.boundingBox())!.x
    // 1 行のまま (折り返さない) で、はみ出した分を送れる
    expect(await nav.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await nav.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
    await expect(nav.getByRole('button', { name: '一覧', exact: true })).toBeInViewport()
    expect((await settings.boundingBox())!.x).toBe(before)
  })

  test('祝日のマスは薄いピンクで、日の一覧の見出しに祝日名が出る', async ({ page }) => {
    await openCalendar(page)
    const holiday = dayCell(page, '2026-11-03')
    const weekday = dayCell(page, '2026-11-04')
    await expect(holiday).toHaveAttribute('data-holiday', '文化の日')
    await expect(weekday).not.toHaveAttribute('data-holiday')
    const bg = (cell: Locator) => cell.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(await bg(holiday)).not.toBe(await bg(weekday))
    // 勤労感謝の日 (11/23) も。日の一覧の見出しに名前
    await dayCell(page, '2026-11-23').click()
    await expect(page.getByRole('region', { name: '11月23日 (月) の予定' }).getByRole('heading')).toContainText(
      '勤労感謝の日',
    )
  })

  test('優先度を「高い」にすると赤系の帯になり、本文に priority= が入る。標準に戻すと消える', async ({ page }) => {
    await openCalendar(page)
    await dayCell(page, DAY).click()
    const pane = dayPane(page)
    const memo = async () =>
      ((await (await page.request.get(`/api/items/${NOTE.id}`)).json()) as { data: { item: { memo: string } } }).data.item
        .memo

    // 書いていなければ標準 (橙)
    await expect(pane.locator('li', { hasText: NOTE.key })).toHaveAttribute('data-priority', 'normal')

    await eventRow(pane).click()
    let dialog = page.getByRole('dialog', { name: '予定を直す' })
    await dialog.getByLabel('優先度').selectOption({ label: '高い' })
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(pane.locator('li', { hasText: NOTE.key })).toHaveAttribute('data-priority', 'high')
    await expect(dayCell(page, DAY).locator('[data-priority="high"]')).toContainText(NOTE.key)
    expect(await memo()).toContain('start=13:00 end=14:30 priority=high')

    await eventRow(pane).click()
    dialog = page.getByRole('dialog', { name: '予定を直す' })
    await expect(dialog.getByLabel('優先度')).toHaveValue('high')
    await dialog.getByLabel('優先度').selectOption({ label: '標準' })
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(pane.locator('li', { hasText: NOTE.key })).toHaveAttribute('data-priority', 'normal')
    expect(await memo()).not.toContain('priority=')
  })

  test('設定で日付の大きさと優先度の色を変えられ、読み込み直しても残る (大きさは端末ごと)', async ({ page, browser }) => {
    await openCalendar(page)
    const settings = async () =>
      ((await (await page.request.get('/api/calendar/settings')).json()) as { data: unknown }).data

    await calendar(page).getByRole('button', { name: 'カレンダーの設定' }).click()
    const panel = page.getByRole('dialog', { name: 'カレンダーの設定' })
    await panel.getByRole('group', { name: '日付の文字の大きさ' }).getByRole('button', { name: '大', exact: true }).click()
    await panel.getByRole('group', { name: '予定の文字の大きさ' }).getByRole('button', { name: '小', exact: true }).click()
    await panel.getByRole('button', { name: '標準を #6b7280 にする' }).click()

    // すぐ効く: 日付は 24px、標準の帯は灰の地に白い文字 (暗い地は白)
    const dayNumber = dayCell(page, DAY).locator('span').first()
    await expect(dayNumber).toHaveCSS('font-size', '24px')
    const chip = dayCell(page, DAY).locator('[data-priority="normal"]')
    await expect(chip).toHaveCSS('background-color', 'rgb(107, 114, 128)')
    await expect(chip).toHaveCSS('color', 'rgb(255, 255, 255)')
    // 予定の文字は 12px (行の高さ 20px は変えない)
    await expect(chip).toHaveCSS('font-size', '12px')
    await expect(chip).toHaveCSS('line-height', '20px')

    // 文字の色も選べる (自動をやめて濃い赤)
    await panel.getByRole('button', { name: '標準の文字を #b91c1c にする' }).click()
    await expect(chip).toHaveCSS('color', 'rgb(185, 28, 28)')

    // 色は少し待ってサーバへ保存される。大きさはサーバへ送らない (端末ごと。docs/126 §1-20)
    await expect.poll(settings).toEqual({
      ...DEFAULT_PREFS,
      colors: { ...DEFAULT_PREFS.colors, normal: '#6b7280' },
      textColors: { ...DEFAULT_PREFS.textColors, normal: '#b91c1c' },
    })
    // 色の写しを消して読み込み直しても、色はサーバから・大きさはこの端末から戻る
    await page.evaluate(() => localStorage.removeItem('qr-calendar-prefs'))
    await page.reload()
    await expect(dayCell(page, DAY).locator('[data-priority="normal"]')).toHaveCSS(
      'background-color',
      'rgb(107, 114, 128)',
    )
    await expect(dayCell(page, DAY).locator('span').first()).toHaveCSS('font-size', '24px')

    // 別の端末 (別のブラウザ文脈) は色だけが同じで、大きさは既定のまま
    const other = await newLoggedInPage(browser)
    await openCalendar(other)
    await expect(dayCell(other, DAY).locator('[data-priority="normal"]')).toHaveCSS(
      'background-color',
      'rgb(107, 114, 128)',
    )
    await expect(dayCell(other, DAY).locator('span').first()).toHaveCSS('font-size', '20px')
    await closePage(other)

    // 既定に戻す
    await calendar(page).getByRole('button', { name: 'カレンダーの設定' }).click()
    await page.getByRole('dialog', { name: 'カレンダーの設定' }).getByRole('button', { name: '既定に戻す' }).click()
    await expect(dayCell(page, DAY).locator('span').first()).toHaveCSS('font-size', '20px')
    await expect(dayCell(page, DAY).locator('[data-priority="normal"]')).toHaveCSS('font-size', '14px')
    await expect.poll(settings).toEqual(DEFAULT_PREFS)
  })

  test('日の予定の行は 28px + 罫線 1px で、地を白にしても済みの丸と罫線が見える', async ({ page }) => {
    await page.request.put('/api/calendar/settings', {
      data: { ...DEFAULT_PREFS, colors: { ...DEFAULT_PREFS.colors, normal: '#ffffff' } },
    })
    await openCalendar(page)
    await dayCell(page, DAY).click()
    const row = dayPane(page).locator('li', { hasText: NOTE.key })
    await expect(row).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    // 行 28px + 下の罫線 1px (表の形。docs/126 §1-27)
    expect((await row.boundingBox())!.height).toBe(29)
    await expect(row).toHaveCSS('border-bottom-width', '1px')
    await expect(row).not.toHaveCSS('border-bottom-color', 'rgb(255, 255, 255)')
    // 丸の縁は白でない (地の白に溶けない。Tailwind v4 は灰を lab() で出すので値は比べない)
    const circle = row.getByRole('button', { name: /を済みにする/ }).locator('span')
    await expect(circle).not.toHaveCSS('border-top-color', 'rgb(255, 255, 255)')
    await expect(circle).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
    await page.request.put('/api/calendar/settings', { data: DEFAULT_PREFS })
  })

  test('題名の文字を押すとその場で直せる (Enter で保存、Esc で取り消し)', async ({ page }) => {
    await openCalendar(page)
    await dayCell(page, DAY).click()
    const pane = dayPane(page)
    const memo = async () =>
      ((await (await page.request.get(`/api/items/${NOTE.id}`)).json()) as { data: { item: { memo: string } } }).data.item
        .memo
    const renamed = `${NOTE.heading} 改`

    await eventRow(pane).locator('[data-event-title]').click()
    const input = pane.getByRole('textbox', { name: '題名' })
    await expect(input).toHaveValue(NOTE.heading)
    // フォームは開かない
    await expect(page.getByRole('dialog', { name: '予定を直す' })).toHaveCount(0)
    await input.fill(renamed)
    await input.press('Enter')
    await expect(input).toHaveCount(0)
    await expect(eventRow(pane)).toContainText(renamed)
    await expect.poll(memo).toMatch(new RegExp(`^# ${renamed}\n`))
    // マス目も新しい題名 (月の予定を取り直した後)
    await expect(dayCell(page, DAY)).toContainText(renamed)

    // Esc は取り消し (ペインは閉じない)
    await eventRow(pane).locator('[data-event-title]').click()
    await pane.getByRole('textbox', { name: '題名' }).fill('取り消す題名')
    await pane.getByRole('textbox', { name: '題名' }).press('Escape')
    await expect(pane).toBeVisible()
    await expect(eventRow(pane)).toContainText(renamed)

    // 題名・時刻以外 (行の右の余白) を押すと今までどおりフォーム
    const rowBox = (await eventRow(pane).boundingBox())!
    await eventRow(pane).click({ position: { x: rowBox.width - 10, y: rowBox.height / 2 } })
    await expect(page.getByRole('dialog', { name: '予定を直す' })).toBeVisible()
    await page.keyboard.press('Escape')

    // 元の題名へ戻す (後のテストが題名で探す)
    await eventRow(pane).locator('[data-event-title]').click()
    await pane.getByRole('textbox', { name: '題名' }).fill(NOTE.heading)
    await pane.getByRole('textbox', { name: '題名' }).press('Enter')
    await expect.poll(memo).toMatch(new RegExp(`^# ${NOTE.heading}\n`))
  })

  test('時刻は 1 行で出し、押すと 15 分刻みで直せる (開始を動かすと終了も動く)', async ({ page }) => {
    await openCalendar(page)
    await dayCell(page, DAY).click()
    const pane = dayPane(page)
    const memo = async () =>
      ((await (await page.request.get(`/api/items/${NOTE.id}`)).json()) as { data: { item: { memo: string } } }).data.item
        .memo
    const time = eventRow(pane).locator('[data-event-time]')
    await expect(time).toHaveText('13:00 ~ 14:30')

    await time.click()
    const panel = page.getByRole('dialog', { name: '時刻' })
    await expect(page.getByRole('dialog', { name: '予定を直す' })).toHaveCount(0)
    await expect(panel.getByLabel('開始').locator('option')).toHaveCount(96)
    await panel.getByLabel('開始').selectOption('09:15')
    // 長さ (1 時間半) を保って終了も動く
    await expect(time).toHaveText('9:15 ~ 10:45')
    await expect.poll(memo).toContain('date=2026-11-05 start=09:15 end=10:45')
    await panel.getByLabel('終了').selectOption('11:00')
    await expect(time).toHaveText('9:15 ~ 11:00')
    await expect.poll(memo).toContain('start=09:15 end=11:00')

    // 元へ戻す (後のテストが 13:00 を見る)
    await panel.getByLabel('開始').selectOption('13:00')
    await panel.getByLabel('終了').selectOption('14:30')
    await expect.poll(memo).toContain('start=13:00 end=14:30')
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(pane).toBeVisible()
  })

  test('日の予定のペインも境界をドラッグして高さを変えられる', async ({ page }) => {
    // Arrange: ノートを開いていない (ノートのペインの境界が無い) カレンダー
    await openCalendar(page)
    await dayCell(page, DAY).click()
    const pane = dayPane(page)
    await expect(pane).toBeVisible()
    const before = await pane.boundingBox()

    // Act: 境界を上へ 120px
    const separator = page.locator('[role="separator"][aria-orientation="horizontal"]').last()
    const handle = await separator.boundingBox()
    if (!handle || !before) throw new Error('境界かペインが見つからない')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 120, { steps: 5 })
    await page.mouse.up()

    // Assert
    await expect.poll(async () => (await pane.boundingBox())?.height ?? 0).toBeGreaterThan(before.height + 60)
  })

  test('︙ をドラッグすると日の中の順を変えられ、本文に order= が入る (↑ ↓ でも)', async ({ page }) => {
    // 同じ日の 10:00 に 2 件目 (時刻順では NOTE (13:00) より上)
    const created = await page.request.put(`/api/items/${NOTE2.id}`, {
      data: { memo: `# ${NOTE2.heading}\n\n#${TAG}\ndate=${DAY} start=10:00\n`, base: 'new', checkpoint: false },
    })
    expect(created.ok()).toBe(true)
    await openCalendar(page)
    await dayCell(page, DAY).click()
    const pane = dayPane(page)
    const titles = () => pane.locator('li [data-event-title]').allTextContents()
    const memoOf = async (id: string) =>
      ((await (await page.request.get(`/api/items/${id}`)).json()) as { data: { item: { memo: string } } }).data.item.memo
    await expect.poll(titles).toEqual([NOTE2.heading, NOTE.heading])

    // NOTE の ︙ を 1 行ぶん上へドラッグ
    const handle = pane.getByRole('button', { name: `${NOTE.heading} を並べ替える` })
    const from = (await handle.boundingBox())!
    const top = (await pane.locator('li').first().boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2, top.y + 4, { steps: 6 })
    await page.mouse.up()
    await expect.poll(titles).toEqual([NOTE.heading, NOTE2.heading])
    await expect.poll(() => memoOf(NOTE.id)).toContain('order=1')
    await expect.poll(() => memoOf(NOTE2.id)).toContain('order=2')
    // マス目も同じ順
    await expect(dayCell(page, DAY).locator('[data-priority]').first()).toContainText(NOTE.key)

    // ↓ で 1 つ下へ戻す
    await handle.focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(titles).toEqual([NOTE2.heading, NOTE.heading])
    await expect.poll(() => memoOf(NOTE.id)).toContain('order=2')
    await expect.poll(() => memoOf(NOTE2.id)).toContain('order=1')
  })

  test('︙ を別の日のマスへドラッグすると、その日へ移る (時刻はそのまま)', async ({ page }) => {
    const OTHER = '2026-11-12'
    await openCalendar(page)
    await dayCell(page, DAY).click()
    const pane = page.getByRole('region', { name: '11月5日 (木) の予定' })
    const memo2 = async () =>
      ((await (await page.request.get(`/api/items/${NOTE2.id}`)).json()) as { data: { item: { memo: string } } }).data.item
        .memo
    const drag = async (handle: Locator, target: Locator) => {
      // 1 日 5 行の月は日のペインより縦に長い。移す先のマスを見える所へ送ってから掴む
      await target.scrollIntoViewIfNeeded()
      const from = (await handle.boundingBox())!
      const to = (await target.boundingBox())!
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
      // 移す先のマスに枠
      await expect(target).toHaveAttribute('data-drop-target', '')
      await page.mouse.up()
      await expect(target).not.toHaveAttribute('data-drop-target')
    }

    await drag(pane.getByRole('button', { name: `${NOTE2.heading} を並べ替える` }), dayCell(page, OTHER))
    // この日の一覧から消え、移した日のマスに出る
    await expect(pane.locator('li', { hasText: NOTE2.key })).toHaveCount(0)
    await expect.poll(memo2).toContain(`date=${OTHER} start=10:00`)
    await expect(dayCell(page, OTHER)).toContainText(NOTE2.key)
    await expect(dayCell(page, DAY)).not.toContainText(NOTE2.key)

    // 移した日の一覧から元の日へ戻す
    await dayCell(page, OTHER).click()
    const otherPane = page.getByRole('region', { name: '11月12日 (木) の予定' })
    await drag(otherPane.getByRole('button', { name: `${NOTE2.heading} を並べ替える` }), dayCell(page, DAY))
    await expect.poll(memo2).toContain(`date=${DAY} start=10:00`)
    await expect(dayCell(page, DAY)).toContainText(NOTE2.key)
  })

  test('検索窓の＋は選んだ日の新しい予定を開く (カレンダーの外では新規ノート)', async ({ page }) => {
    await openCalendar(page)
    const plus = page.getByRole('button', { name: 'カレンダーに追加' })
    await expectHydrated(plus)
    await expect(page.getByRole('link', { name: '新規ノート' })).toHaveCount(0)
    await dayCell(page, DAY).click()
    await plus.click()
    // 保存はしない (番号が毎回新しく、E2E の門番で消せない)
    await expect(page).toHaveURL(new RegExp(`tab=event.*date=${DAY}`))
    const form = page.getByRole('form', { name: '予定' })
    await expect(form.getByRole('button', { name: '追加' })).toBeVisible()
    await expect(form.getByLabel('日付')).toHaveValue(DAY)

    await page.goto(`/?q=${encodeURIComponent(QUERY)}`)
    await expect(page.getByRole('link', { name: '新規ノート' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'カレンダーに追加' })).toHaveCount(0)
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

  test('ヘッダーのロゴはカレンダーを出し直す (同じ検索語・同じ月。ノートは閉じる)', async ({ page }) => {
    await openCalendar(page)
    const logo = page.locator('header a[href="/"]').first()
    // 予定のノートを開いた状態から
    await page.evaluate((url) => window.history.pushState(null, '', url), noteHref('&tab=event'))
    await expect(page).toHaveURL(/\/item\//)
    await logo.click()
    await expect(page).toHaveURL(new RegExp(`/\\?q=${encodeURIComponent(QUERY)}&cal=${MONTH}$`))
    await expect(calendar(page).getByRole('heading', { name: '2026年11月' })).toBeVisible()
    // カレンダーを出したままもう一度押すと、月の予定を取り直す
    const refetch = page.waitForRequest((request) => request.url().includes('/api/calendar?'))
    await logo.click()
    await refetch

    // 一覧の画面ではいままでどおりホームへ
    await page.goto(`/?q=${encodeURIComponent(QUERY)}`)
    await expectHydrated(page.locator('header a[href="/"]').first())
    await page.locator('header a[href="/"]').first().click()
    await expect(page).toHaveURL(/\/$/)
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
