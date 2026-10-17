import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import QRCode from 'qrcode'
import { closePage, expect, newLoggedInPage, test } from './helpers'

// 読み取りの瞬間の音 (docs/112-スキャン音量計画.md §2-4)。
//
// v0.23.45 はライブラリに鳴らさせていて、読めた直後にモーダルを閉じると
// ライブラリの後始末が pause() し、iPhone ではほぼ鳴らなかった。ここでは
// **鳴らした音が閉じた後に止められないこと**を見る。
//
// カメラは Chromium の偽デバイスに、QR を描いた y4m を流して代える。
// 音そのものは聞かない — play / pause を差し替えて呼ばれ方だけを記録する
const SCANNED_TEXT = 'e2e-scan-beep'
// ライブラリは幅・高さとも 640 以上を求める (defaultConstraints の min)
const WIDTH = 720
const HEIGHT = 720
const FRAMES = 5
const QR_SCALE = 8

// QR を白地の中央に描いた y4m (YUV 4:2:0) を作る。ffmpeg を要らなくするため
// 自分で組み立てる (ヘッダ + FRAME ごとに Y・U・V の平面を並べるだけの形式)
function writeQrVideo(file: string): void {
  const qr = QRCode.create(SCANNED_TEXT, { errorCorrectionLevel: 'M' })
  const size = qr.modules.size
  const left = Math.floor((WIDTH - size * QR_SCALE) / 2)
  const top = Math.floor((HEIGHT - size * QR_SCALE) / 2)
  const luma = Buffer.alloc(WIDTH * HEIGHT, 235)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!qr.modules.get(row, col)) {
        continue
      }
      for (let dy = 0; dy < QR_SCALE; dy++) {
        const offset = (top + row * QR_SCALE + dy) * WIDTH + left + col * QR_SCALE
        luma.fill(16, offset, offset + QR_SCALE)
      }
    }
  }
  const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2), 128)
  const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma, chroma])
  const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F10:1 Ip A1:1 C420jpeg\n`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, Buffer.concat([header, ...Array.from({ length: FRAMES }, () => frame)]))
}

const VIDEO_FILE = path.join(__dirname, '..', 'test-results', 'scan-beep-qr.y4m')
writeQrVideo(VIDEO_FILE)

test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${VIDEO_FILE}`,
    ],
  },
})

interface MediaLog {
  __mediaLog?: { op: 'play' | 'pause'; src: string }[]
}

async function mediaLog(page: Page) {
  return page.evaluate(() => (window as MediaLog).__mediaLog ?? [])
}

test('読めたら自前の音で 1 回鳴らし、閉じても止めない', async ({ browser }) => {
  const page = await newLoggedInPage(browser)
  await page.addInitScript(() => {
    const log: { op: 'play' | 'pause'; src: string }[] = []
    ;(window as MediaLog).__mediaLog = log
    // 音のある要素 (audio) だけを記録する。カメラ映像の <video> は除く
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      if (this instanceof HTMLAudioElement) {
        log.push({ op: 'play', src: this.src.slice(0, 40) })
        return Promise.resolve()
      }
      return Promise.resolve()
    }
    const pause = HTMLMediaElement.prototype.pause
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      if (this instanceof HTMLAudioElement) {
        log.push({ op: 'pause', src: this.src.slice(0, 40) })
      }
      return pause.call(this)
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'スキャン', exact: true }).click()

  // 読めたら閉じて検索へ遷移する
  await expect(page).toHaveURL(new RegExp(`q=${SCANNED_TEXT}`), { timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'スキャンを閉じる' })).toHaveCount(0)

  const log = await mediaLog(page)
  // 鳴らしたのは自前の WAV 1 回だけ (ライブラリ内蔵の mp3 は鳴らさない)
  expect(log.filter((e) => e.op === 'play')).toEqual([
    { op: 'play', src: expect.stringMatching(/^data:audio\/wav;base64,/) },
  ])
  // 閉じた後も誰も止めない
  expect(log.filter((e) => e.op === 'pause')).toEqual([])
  await closePage(page)
})
