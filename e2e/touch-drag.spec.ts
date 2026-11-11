import { AUTH_FILE, BASE_URL } from './env'
import { expect, expectHydrated, test } from './helpers'
import { e2eNote, removeE2eNote } from './notes'

// 指 (タッチ) でのドラッグ (docs/126 §1-30)。釦に付けた touch-none が全体の CSS
// (button { touch-action: manipulation }) に負けていて、つまみをなぞるとブラウザが
// スクロールとして横取りし pointercancel で止まっていた。マウスの E2E では出ない
const A = e2eNote(97, 'タッチ甲')
const B = e2eNote(98, 'タッチ乙')
const TAG = 'zze2etouch'
const DAY = '2026-11-05'

test.describe('タッチでのドラッグ', () => {
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL, storageState: AUTH_FILE })
    const page = await context.newPage()
    for (const note of [A, B]) {
      await removeE2eNote(page, note)
    }
    await context.close()
  })

  test('日の一覧の ︙ を指でなぞると並べ替えられる', async ({ browser }) => {
    // 掃除は画面の操作で消すので、ふつうの (マウスの) 環境で行う
    const setup = await browser.newContext({ baseURL: BASE_URL, storageState: AUTH_FILE })
    const setupPage = await setup.newPage()
    for (const note of [A, B]) {
      await removeE2eNote(setupPage, note)
    }
    await setup.close()

    const context = await browser.newContext({
      baseURL: BASE_URL,
      storageState: AUTH_FILE,
      hasTouch: true,
      isMobile: true,
      viewport: { width: 375, height: 667 },
    })
    const page = await context.newPage()
    for (const [note, start] of [
      [A, '09:00'],
      [B, '10:00'],
    ] as const) {
      const created = await page.request.put(`/api/items/${note.id}`, {
        data: { memo: `# ${note.heading}\n\n#${TAG}\ndate=${DAY} start=${start}\n`, base: 'new', checkpoint: false },
      })
      expect(created.ok()).toBe(true)
    }
    await context.addCookies([{ name: 'panes', value: '2', url: BASE_URL }])
    await page.goto(`/?q=%23${TAG}&cal=2026-11`)
    const cell = page.locator(`[data-search-results] [data-calendar] [data-day="${DAY}"]`)
    await expectHydrated(cell)
    await cell.click()
    const pane = page.getByRole('region', { name: '11月5日 (木) の予定' })
    const titles = () => pane.locator('li [data-event-title]').allTextContents()
    await expect.poll(titles).toEqual([A.heading, B.heading])

    // 乙の ︙ を指で 1 行ぶん上へなぞる (CDP のタッチ。Playwright の touchscreen は tap だけ)
    const handle = pane.getByRole('button', { name: `${B.heading} を並べ替える` })
    await expect(handle).toHaveCSS('touch-action', 'none')
    const box = (await handle.boundingBox())!
    const cdp = await context.newCDPSession(page)
    const x = box.x + box.width / 2
    let y = box.y + box.height / 2
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 0; i < 8; i++) {
      y -= 5
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

    await expect.poll(titles).toEqual([B.heading, A.heading])
    await context.close()
  })

  // 隠したペインの端のタブも釦なので、同じ理由で指では引き出せなかった (docs/86 §4-21)
  for (const tab of [
    { name: 'フォルダーを開く', from: '2', to: '3', dx: 160, dy: 0 },
    { name: '下のペインを開く', from: '1', to: '2', dx: 0, dy: -250 },
  ] as const) {
    test(`端のタブ「${tab.name}」を指で引き出すと戻る`, async ({ browser }) => {
      const context = await browser.newContext({
        baseURL: BASE_URL,
        storageState: AUTH_FILE,
        hasTouch: true,
        isMobile: true,
        viewport: { width: 375, height: 667 },
      })
      await context.addCookies([{ name: 'panes', value: tab.from, url: BASE_URL }])
      const page = await context.newPage()
      await page.goto(`/?q=%23${TAG}&cal=2026-11`)
      const handle = page.getByRole('button', { name: tab.name })
      await expectHydrated(handle)
      await expect(handle).toHaveCSS('touch-action', 'none')
      const box = (await handle.boundingBox())!
      // タブ (20px) の外、画面の端から 40px の所を掴む。指で触れる範囲は
      // 画面の上で 44px まで広げてある (docs/86 §4-26・§4-27)
      let x = tab.dx > 0 ? 40 : box.x + box.width / 2
      let y = tab.dy < 0 ? 667 - 40 : box.y + box.height / 2
      expect(await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('button')?.getAttribute('aria-label'), [x, y])).toBe(tab.name)
      const cdp = await context.newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      for (let i = 0; i < 10; i++) {
        x += tab.dx / 10
        y += tab.dy / 10
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect.poll(() => page.locator('[data-panes]').getAttribute('data-panes')).toBe(tab.to)
      await context.close()
    })
  }
})
