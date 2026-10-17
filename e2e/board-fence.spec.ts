import {
  clearEditor,
  closePage,
  expect,
  memoEditor,
  newLoggedInPage,
  test,
} from './helpers'
import { e2eNote, removeE2eNote } from './notes'

// 実体配線図フェンス (docs/97) が**ブラウザで実際に描かれる**ことを見る。
//
// 回路図と違って図はサーバから届かない。処理系を動的 import して、その場で
// SVG を組んで貼る。**動くかどうかは本物のブラウザでしか分からない** —
// 単体試験は node で処理系を直に呼んでいるだけで、動的 import が束に乗ったか、
// クライアント部品として動くかまでは見ていない。
//
// id は採番せず `/edit/<id>` で直に決める (note-lifecycle.spec.ts と同じ理由)。
// 本文 1 行目は E2E の見出し (片付けが検索で引く)
const NOTE = e2eNote(10, 'board fence')
const ITEM_ID = NOTE.id

const BODY = [
  NOTE.heading,
  '',
  '```breadboard',
  'board: half',
  'parts:',
  '  R1: resistor a5 a10 330',
  '  D1: led b12(A) b13(K) red',
  'wires:',
  '  - +t5 -- a5 red',
  '  - a10 -- b12',
  '```',
  '',
  '```perfboard',
  'board: 28x18',
  'parts:',
  '  R1: resistor b2 b7 1k',
  'wires:',
  '  - b7 -- d7',
  '```',
].join('\n')

test.describe.configure({ mode: 'serial' })

test.describe('実体配線図フェンス', () => {
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

  test('書いたフェンスが、閲覧でブラウザ上の SVG になる', async ({ page }) => {
    // Arrange
    await page.goto(`/edit/${ITEM_ID}`)
    const save = page.getByRole('button', { name: '更新', exact: true })
    await expect(save).toBeVisible()
    await clearEditor(page)

    // Act — **貼り付けで入れる。** 1 字ずつ打つと CodeMirror の自動閉じが
    // バッククォートを足してフェンスが壊れる
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await memoEditor(page).click()
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text)
    }, BODY)
    await page.keyboard.press('ControlOrMeta+v')
    await save.click()

    // Assert — 2 枚とも図になる。図は useEffect の中で動的 import してから
    // 組むので、現れるまで待つ
    await expect(page).toHaveURL((url) => url.pathname === `/item/${ITEM_ID}`)
    const diagrams = page.locator('.board-diagram')
    await expect.poll(() => diagrams.locator('svg').count()).toBe(2)

    // 板が描けている (穴の丸がある) ことまで見る。「描画中」だけが残っていたら
    // 処理系の読み込みで落ちている
    expect(await diagrams.locator('svg circle').first().isVisible()).toBe(true)
    await expect(page.getByText('図を描画中')).toHaveCount(0)
    // **読めない行は 1 つも無い。** 出るのはユニバーサル基板の ERC
    // (「つながっていません」) だけで、これはお知らせ (琥珀) として出る
    await expect(page.locator('.board-issues li.text-red-700')).toHaveCount(0)
    await expect(
      page.locator('.board-issues li.text-amber-800').first(),
    ).toContainText('つながっていません')
  })
})
