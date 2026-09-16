import type { Locator, Page } from '@playwright/test'
import { expect } from './helpers'

// お絵かき画面 (components/draw/DrawModal.tsx) を E2E から触る道具 (draw.spec.ts)。
// 道具・レイヤパネルの操作、canvas への描き込み、画素の比べ方をまとめる。
// 罠は e2e/README.md の「お絵かき」

// 「何も起きない」には待つ証拠が無い。履歴のまとめ (SNAPSHOT_DEBOUNCE_MS =
// 150ms) と数フレームを越えるだけ待ってから比べる
const NOTHING_HAPPENS_MS = 500

// ------------------------------------------------------------------------
// 画面の部品

export function drawDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'お絵かき' })
}

export function drawButton(page: Page, name: string): Locator {
  return drawDialog(page).getByRole('button', { name, exact: true })
}

// canvas には名前が無い (fabric が作る要素)。構造で取る。
// 下段が描いた絵、上段は選択枠と描きかけの線
export function lowerCanvas(page: Page): Locator {
  return drawDialog(page).locator('canvas.lower-canvas')
}

function upperCanvas(page: Page): Locator {
  return drawDialog(page).locator('canvas.upper-canvas')
}

export async function chooseTool(page: Page, name: string): Promise<void> {
  const button = drawButton(page, name)
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

export async function canvasSize(page: Page): Promise<{ width: number; height: number }> {
  return lowerCanvas(page).evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width,
    height: canvas.height,
  }))
}

// ------------------------------------------------------------------------
// レイヤパネル

export async function withLayerPanel(page: Page, act: (menu: Locator) => Promise<void>): Promise<void> {
  // 開くボタンの名前はアクティブレイヤ (「レイヤ N」) で変わる
  await drawDialog(page).getByRole('button', { name: /^レイヤ \d$/ }).click()
  const menu = drawDialog(page).getByRole('menu')
  await expect(menu).toBeVisible()
  await act(menu)
  // パネルの外の透明な覆いを押して閉じる
  await drawButton(page, 'レイヤパネルを閉じる').click()
  await expect(menu).toBeHidden()
}

// 行の名前は「レイヤ N」の直後にオブジェクト数が付く (間に空白が入るとは限らない)。
// N は 1 桁なので頭の一致で足りる
function layerRow(menu: Locator, layer: number): Locator {
  return menu.getByRole('menuitemradio', { name: new RegExp(`^レイヤ ${layer}`) })
}

// パネルの行の文字 (「レイヤ N」とオブジェクト数)
export async function layerRowText(page: Page, layer: number): Promise<string> {
  let text = ''
  await withLayerPanel(page, async (menu) => {
    text = await layerRow(menu, layer).innerText()
  })
  return text
}

export async function activateLayer(menu: Locator, layer: number): Promise<void> {
  const row = layerRow(menu, layer)
  await row.click()
  await expect(row).toHaveAttribute('aria-checked', 'true')
}

export async function toggleLayer(menu: Locator, name: string): Promise<void> {
  await menu.getByRole('button', { name, exact: true }).click()
}

// ------------------------------------------------------------------------
// 画素

// canvas の見えている範囲に対する割合 (0〜1)
interface Spot {
  x: number
  y: number
}

async function toScreen(page: Page, spot: Spot): Promise<Spot> {
  const box = await upperCanvas(page).boundingBox()
  if (!box) {
    throw new Error('canvas が表示されていない')
  }
  return { x: box.x + box.width * spot.x, y: box.y + box.height * spot.y }
}

export async function drag(page: Page, from: Spot, to: Spot): Promise<void> {
  const start = await toScreen(page, from)
  const end = await toScreen(page, to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await page.mouse.up()
}

export async function tap(page: Page, spot: Spot): Promise<void> {
  const point = await toScreen(page, spot)
  await page.mouse.click(point.x, point.y)
}

// 下地 (白) を塗る前の、まだ何も描かれていない canvas の印
const UNRENDERED = 'unrendered'

// 描いた絵 (下段 canvas) の画素の SHA-256
export async function canvasHash(page: Page): Promise<string> {
  return lowerCanvas(page).evaluate(async (canvas: HTMLCanvasElement, unrendered) => {
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('2d の context が取れない')
    }
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    if (pixels[3] === 0) {
      return unrendered
    }
    const digest = await crypto.subtle.digest('SHA-256', pixels)
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }, UNRENDERED)
}

// before から変わり、続けて 2 回読んで同じ (描き終わった) ハッシュを返す。
// 塗り・モザイクは非同期で足され、元に戻すは読み込みながら描き直すので、
// 途中の絵を掴まないよう落ち着くまで待つ
export async function changedHash(page: Page, before: string): Promise<string> {
  let last = ''
  await expect
    .poll(async () => {
      const current = await canvasHash(page)
      const isSettled = current !== before && current !== UNRENDERED && current === last
      last = current
      return isSettled
    })
    .toBe(true)
  return last
}

// 描き直しが落ち着いたハッシュ。道具を替えると選択が外れて描き直され、
// 選択中とは画素がわずかにずれる (キャッシュからの描画になる) ので、
// 後で「同じに戻る」と比べる基準はこれで取る
export async function settledHash(page: Page): Promise<string> {
  return changedHash(page, UNRENDERED)
}

export async function expectHash(page: Page, expected: string): Promise<void> {
  await expect.poll(() => canvasHash(page)).toBe(expected)
}

// 直前の操作が履歴に積まれるのを待つ。積む前 (150ms のまとめの間) に次の
// 操作をすると 2 つが 1 手に合わさり、元に戻すが 2 手ぶん戻る。
// 移動のように件数もボタンの状態も変わらない操作には、積んだ証拠が無い
export async function waitForHistory(page: Page): Promise<void> {
  await page.waitForTimeout(NOTHING_HAPPENS_MS)
}

export async function expectHashStays(page: Page, expected: string): Promise<void> {
  await waitForHistory(page)
  expect(await canvasHash(page)).toBe(expected)
}

// 画素そのものを控えて比べる (ページの中に置く。数 MB あるので Node へは運ばない)。
//
// 塗り・モザイク・消しゴム・文字が重なった絵は、JSON から描き直すと縁の数画素が
// わずかにずれる (実測で 3 画素・最大 4 階調)。ハッシュの一致では見られないので、
// 階調の差が小さい画素は数えず、大きくずれた画素の数で「戻った」を判定する
const PIXEL_TOLERANCE = 16
export const MAX_STRAY_PIXELS = 1000

type PixelStore = { __drawE2e?: Record<string, Uint8ClampedArray> }

export async function rememberPixels(page: Page, key: string): Promise<void> {
  await lowerCanvas(page).evaluate((canvas: HTMLCanvasElement, name) => {
    const store = window as unknown as PixelStore
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('2d の context が取れない')
    }
    store.__drawE2e = {
      ...store.__drawE2e,
      [name]: context.getImageData(0, 0, canvas.width, canvas.height).data,
    }
  }, key)
}

export async function strayPixels(page: Page, key: string): Promise<number> {
  return lowerCanvas(page).evaluate(
    (canvas: HTMLCanvasElement, { name, tolerance }) => {
      const saved = (window as unknown as PixelStore).__drawE2e?.[name]
      const context = canvas.getContext('2d')
      if (!saved || !context) {
        throw new Error(`控えた画素 ${name} が無い`)
      }
      const current = context.getImageData(0, 0, canvas.width, canvas.height).data
      if (current.length !== saved.length) {
        return Number.POSITIVE_INFINITY
      }
      let count = 0
      for (let at = 0; at < current.length; at += 4) {
        for (let channel = 0; channel < 4; channel += 1) {
          if (Math.abs(current[at + channel] - saved[at + channel]) > tolerance) {
            count += 1
            break
          }
        }
      }
      return count
    },
    { name: key, tolerance: PIXEL_TOLERANCE },
  )
}

// ------------------------------------------------------------------------
// タッチ

// 1 本指で線を引く。secondFinger なら、引いている途中で 2 本目が着いて離れる。
// `page.touchscreen` は 1 点の tap しか出せないので、TouchEvent を直に投げる
// (hasTouch のコンテキストでないと Touch が作れない。e2e/README.md)
export async function touchStroke(page: Page, secondFinger: boolean): Promise<void> {
  await upperCanvas(page).evaluate((canvas: HTMLCanvasElement, withSecond) => {
    const box = canvas.getBoundingClientRect()
    const at = (identifier: number, fx: number, fy: number) =>
      new Touch({
        identifier,
        target: canvas,
        clientX: box.left + box.width * fx,
        clientY: box.top + box.height * fy,
      })
    const fire = (type: string, touches: Touch[], changed: Touch[]) => {
      canvas.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          touches,
          targetTouches: touches,
          changedTouches: changed,
        }),
      )
    }
    const path = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((fx) => at(0, fx, 0.5))
    fire('touchstart', [path[0]], [path[0]])
    fire('touchmove', [path[1]], [path[1]])
    fire('touchmove', [path[2]], [path[2]])
    if (withSecond) {
      const second = at(1, 0.5, 0.8)
      fire('touchstart', [path[2], second], [second])
      fire('touchend', [path[2]], [second])
    }
    for (const point of path.slice(3)) {
      fire('touchmove', [point], [point])
    }
    fire('touchend', [], [path[path.length - 1]])
  }, secondFinger)
}
