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
async function openWithBody(page: Page, body = BODY): Promise<void> {
  await page.goto(`/edit/${ITEM_NO}`)
  await expect(page.getByRole('button', { name: '更新', exact: true })).toBeVisible()
  await clearEditor(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await memoEditor(page).click()
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text)
  }, body)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(page.locator('input[name="memo"]')).toHaveValue(body)
}

function editButton(page: Page) {
  return page.getByRole('button', { name: '図を編集', exact: true })
}

// 図 (ライブプレビューのウィジェット) を押してカーソルをフェンスへ移し、殻を開く
async function openMap(page: Page): Promise<FrameLocator> {
  await page.locator('.cm-qr-fence-box').click()
  return openMapAtCursor(page)
}

// カーソルが既にフェンスの中にあるとき、「図を編集」を押して殻を開く
async function openMapAtCursor(page: Page): Promise<FrameLocator> {
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

function discardMap(page: Page) {
  return page
    .getByRole('dialog', { name: '図を編集' })
    .getByRole('button', { name: '破棄', exact: true })
    .click()
}

// 破棄の前の確認に答え、出た文言を控える。出なければ空のまま
function answerDiscardConfirm(page: Page, accept: boolean): string[] {
  const messages: string[] = []
  page.on('dialog', (dialog) => {
    messages.push(dialog.message())
    void (accept ? dialog.accept() : dialog.dismiss())
  })
  return messages
}

// 属性の欄で R1 の値を 1k に直す。部品を押すと属性の欄が出て、Enter で行へ当たる。
// 殻が写しを書き換えると、殻の中の「元に戻す」が押せるようになるので、それを待つ
async function editValue(map: FrameLocator): Promise<void> {
  await map.locator('.cf-chip[data-part="R1"]').click()
  const value = map.locator('.cf-inspector input[name="value"]')
  await expect(value).toBeVisible()
  await value.fill('1k')
  await value.press('Enter')
  await expect(map.locator('.cf-undo')).toBeEnabled()
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

    // Act
    await editValue(map)
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

  // 破棄 (docs/99 §2 の決め 6 の追記)。殻の履歴は閉じると消えるので、
  // 変えていれば確認を挟み、了承されたら本文に当てずに戻る
  test('値を直して破棄し、確認で了承すると本文は変わらない', async ({ page }) => {
    // Arrange
    await openWithBody(page)
    const map = await openMap(page)
    await editValue(map)
    const messages = answerDiscardConfirm(page, true)

    // Act
    await discardMap(page)

    // Assert
    await expect(page.getByRole('dialog', { name: '図を編集' })).toHaveCount(0)
    expect(messages).toEqual(['図の変更は本文に反映されません。破棄しますか？'])
    await expect(memo(page)).toHaveValue(BODY)
  })

  test('破棄の確認を取り消すと殻は開いたままで、閉じれば反映される', async ({ page }) => {
    // Arrange
    await openWithBody(page)
    const map = await openMap(page)
    await editValue(map)
    const messages = answerDiscardConfirm(page, false)

    // Act
    await discardMap(page)

    // Assert — 殻も直した値も残っている
    expect(messages).toHaveLength(1)
    await expect(page.getByRole('dialog', { name: '図を編集' })).toBeVisible()
    await expect(map.locator('.cf-undo')).toBeEnabled()
    await closeMap(page)
    await expect(memo(page)).toHaveValue(BODY.replace('330', '1k'))
  })

  test('何もせずに破棄すると確認なしで閉じる', async ({ page }) => {
    // Arrange
    await openWithBody(page)
    await openMap(page)
    const messages = answerDiscardConfirm(page, false)

    // Act
    await discardMap(page)

    // Assert
    await expect(page.getByRole('dialog', { name: '図を編集' })).toHaveCount(0)
    expect(messages).toEqual([])
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

// 回路図 (YAML) の殻 (docs/100)。掴むのは清書ではなく、つながりだけの簡略図
// (TeX は要らない)。
//
// **ライブプレビューは切って流す。** 回路図の清書はサーバが TeX で描き、手元の DB に
// 控え (circuit_svgs) を書く。ここで見たいのは殻の往復だけなので、清書を描かせない —
// カーソルは生の字をクリックして置く
test.describe('図を編集 (回路図)', () => {
  const CIRCUIT = ['回路図の試験', '', '```circuit', 'parts:', '  R1: resistor a1 a2 10k', '```', ''].join('\n')

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('qr-search:live-preview', '0')
    })
  })

  // 回路図の部品には板のような当たり判定の箱が無く、線そのものが当たり判定。
  // 升 (34 単位の正方形) の縦の真ん中を部品の足が横切り、升の真ん中には節点の丸
  // (押すと部品ではなく節点を掴む) がある。**a1 の右寄り、丸の外の足**を押す
  async function pressPointOnLead(map: FrameLocator, address: string) {
    const cell = await map.locator(`.cf-cell[data-address="${address}"]`).boundingBox()
    if (cell === null) {
      throw new Error(`升 ${address} の位置が取れない`)
    }
    return { x: cell.x + cell.width * 0.68, y: cell.y + cell.height / 2, cell }
  }

  async function openCircuitMap(page: Page): Promise<FrameLocator> {
    await openWithBody(page, CIRCUIT)
    await memoEditor(page).getByText('R1: resistor a1 a2 10k').click()
    return openMapAtCursor(page)
  }

  test('属性の欄で値を直して閉じると、その行だけが変わる', async ({ page }) => {
    // Arrange
    const map = await openCircuitMap(page)
    const lead = await pressPointOnLead(map, 'a1')

    // Act — 足を押して選ぶと属性の欄が出る
    await page.mouse.click(lead.x, lead.y)
    const value = map.locator('.cf-inspector input[name="value"]')
    await expect(value).toHaveValue('10k')
    await value.fill('4k7')
    await value.press('Enter')
    await expect(map.locator('.cf-undo')).toBeEnabled()
    await closeMap(page)

    // Assert
    await expect(memo(page)).toHaveValue(CIRCUIT.replace('10k', '4k7'))
  })

  test('部品を掴んで 1 行下げると、両端の番地が書き換わる', async ({ page }) => {
    // Arrange
    const map = await openCircuitMap(page)
    const lead = await pressPointOnLead(map, 'a1')

    // Act — 升 1 つぶん下 (b1) の同じ所で離す
    await page.mouse.move(lead.x, lead.y)
    await page.mouse.down()
    await page.mouse.move(lead.x, lead.y + lead.cell.height, { steps: 12 })
    await page.mouse.up()
    await expect(map.locator('.cf-undo')).toBeEnabled()
    await closeMap(page)

    // Assert
    await expect(memo(page)).toHaveValue(CIRCUIT.replace('a1 a2', 'b1 b2'))
  })
})
