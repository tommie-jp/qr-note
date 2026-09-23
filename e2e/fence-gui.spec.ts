import type { FrameLocator, Page } from '@playwright/test'
import { E2E_ITEM_PREFIX } from './env'
import {
  clearEditor,
  closePage,
  expect,
  hasHorizontalScroll,
  memoEditor,
  newTouchPage,
  test,
} from './helpers'

// 図を掴んで動かす殻 (docs/99-フェンスGUI編集計画.md) を編集画面から開く。
//
// 殻は上流 (fence-kit) の頁を iframe の srcdoc で動かす。**動くかどうかは
// 本物のブラウザでしか分からない** — 単体試験は殻の宿主 (session) と橋を
// node で見ているだけで、/fence/map.web.js が届くか、中の CSP と nonce で
// 動くか、指やマウスの操作が本文まで戻ってくるかは見ていない。
//
// **保存はしない。** 見るのはエディタの本文 (hidden の memo 欄) だけなので、
// ノートは作らず、DB にも何も残さない
const ITEM_NO = `${E2E_ITEM_PREFIX}6`

const BODY = [
  '図を編集の試験',
  '',
  '```breadboard',
  'board: half',
  'parts:',
  '  R1: resistor a5 a10 330',
  '```',
  '',
  'あとがき。',
].join('\n')

// 編集画面を開いて本文を入れる。**貼り付けで入れる** — 1 字ずつ打つと
// CodeMirror の自動閉じがバッククォートを足してフェンスが壊れる
async function openWithBody(page: Page): Promise<void> {
  await page.goto(`/edit/${ITEM_NO}`)
  await expect(page.getByRole('button', { name: '更新', exact: true })).toBeVisible()
  await clearEditor(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await memoEditor(page).click()
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text)
  }, BODY)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(page.locator('input[name="memo"]')).toHaveValue(BODY)
}

function editButton(page: Page) {
  return page.getByRole('button', { name: '図を編集', exact: true })
}

// 図 (ライブプレビューのウィジェット) を押してカーソルをフェンスへ移し、殻を開く
async function openMap(page: Page): Promise<FrameLocator> {
  await page.locator('.cm-qr-fence-box').click()
  await expect(editButton(page)).toBeEnabled()
  await editButton(page).click()
  // 同じ出所を与えない (docs/99 §2 の決め 14)。外れると殻がアプリの cookie や
  // 鍵束に触れる形になる
  await expect(page.locator('iframe[title="図を編集"]')).toHaveAttribute(
    'sandbox',
    'allow-scripts',
  )
  const map = page.frameLocator('iframe[title="図を編集"]')
  await expect(map.locator('.cf-chip[data-part="R1"]')).toBeVisible()
  return map
}

function closeMap(page: Page) {
  return page
    .getByRole('dialog', { name: '図を編集' })
    .getByRole('button', { name: '閉じる', exact: true })
    .click()
}

const memo = (page: Page) => page.locator('input[name="memo"]')

test.describe('図を編集', () => {
  test('フェンスの外では押せず、図を押すと押せるようになる', async ({ page }) => {
    // Arrange — 貼り付けた直後のカーソルは本文の末尾 (あとがき)
    await openWithBody(page)

    // Assert
    await expect(editButton(page)).toBeDisabled()
    await page.locator('.cm-qr-fence-box').click()
    await expect(editButton(page)).toBeEnabled()
  })

  test('属性の欄で値を直して閉じると、その行だけが変わる。元に戻す 1 回で戻る', async ({
    page,
  }) => {
    // Arrange
    await openWithBody(page)
    const map = await openMap(page)

    // Act — 部品を押すと属性の欄が出る。Enter で行へ当たる
    await map.locator('.cf-chip[data-part="R1"]').click()
    const value = map.locator('.cf-inspector input[name="value"]')
    await expect(value).toBeVisible()
    await value.fill('1k')
    await value.press('Enter')
    // 殻が写しを書き換えると、殻の中の「元に戻す」が押せるようになる
    await expect(map.locator('.cf-undo')).toBeEnabled()
    await closeMap(page)

    // Assert
    await expect(page.getByRole('dialog', { name: '図を編集' })).toHaveCount(0)
    await expect(memo(page)).toHaveValue(BODY.replace('330', '1k'))

    // 開いてから閉じるまでが 1 段
    await page.getByRole('button', { name: '元に戻す', exact: true }).click()
    await expect(memo(page)).toHaveValue(BODY)
  })

  test('何もせずに閉じると本文は変わらない', async ({ page }) => {
    await openWithBody(page)
    await openMap(page)

    await closeMap(page)

    await expect(page.getByRole('dialog', { name: '図を編集' })).toHaveCount(0)
    await expect(memo(page)).toHaveValue(BODY)
  })

  // 殻の主な使い方。マウスで部品を掴んで 3 行下げる (a → d)。
  // **掴むのも離すのも穴の上で。** 殻は離した所の穴 (.cf-cell) を行き先にし、
  // 穴の外で離すと「元へ戻す」(上流の mapState)。部品の真ん中はラベル込みで
  // 穴の間に落ちることがあるので、部品が乗っている穴 a7 を掴む
  test('部品を掴んで動かすと、番地が書き換わる', async ({ page }) => {
    // Arrange
    await openWithBody(page)
    const map = await openMap(page)
    const from = await map.locator('.cf-cell[data-address="a7"]').boundingBox()
    const to = await map.locator('.cf-cell[data-address="d7"]').boundingBox()
    if (from === null || to === null) {
      throw new Error('穴の位置が取れない')
    }
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
    const dy = to.y + to.height / 2 - start.y

    // Act
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x, start.y + dy, { steps: 12 })
    await page.mouse.up()
    await expect(map.locator('.cf-undo')).toBeEnabled()
    await closeMap(page)

    // Assert
    await expect(memo(page)).toHaveValue(BODY.replace('a5 a10', 'd5 d10'))
  })

  // QR ノートにダークモードは無い。sandbox の iframe には外から色を書けないので、
  // 頁の頭の印 (data-theme="light") だけで明るいままになっていることを見る
  test('端末が暗色でも殻は明るいまま', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await openWithBody(page)

    const map = await openMap(page)

    const background = await map
      .locator('html')
      .evaluate((root) =>
        getComputedStyle(root).getPropertyValue('--vscode-editor-background').trim(),
      )
    expect(background).toBe('#ffffff')
  })

  // iPhone の幅で、指で開く。上流では狭い画面でマップが 0 px 幅になったことが
  // ある (52 の docs/32)。器 (flex の縦積み) と iframe の大きさを数で見る
  test('iPhone の幅でも殻が画面いっぱいに開き、図が見える', async ({ browser }) => {
    // Arrange
    const page = await newTouchPage(browser)
    await openWithBody(page)

    // Act
    await page.locator('.cm-qr-fence-box').tap()
    await expect(editButton(page)).toBeEnabled()
    await editButton(page).tap()

    // Assert
    const frame = await page.locator('iframe[title="図を編集"]').boundingBox()
    const viewport = page.viewportSize()
    if (frame === null || viewport === null) {
      throw new Error('殻か画面の大きさが取れない')
    }
    expect(frame.width).toBe(viewport.width)
    // 上の帯 (題と閉じる) を除いた残り全部
    expect(frame.height).toBeGreaterThan(viewport.height * 0.8)
    const map = page.frameLocator('iframe[title="図を編集"]')
    await expect(map.locator('.cf-chip[data-part="R1"]')).toBeInViewport()
    expect(await hasHorizontalScroll(page)).toBe(false)
    await closePage(page)
  })
})
