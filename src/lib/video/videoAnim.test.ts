import sharp from 'sharp'
import { expect, test } from 'vitest'
import { MAX_VIDEO_ANIM_FRAMES } from '../uploads'
import {
  isAnimatedWebp,
  makeVideoAnim,
  MAX_VIDEO_ANIM_BYTES,
  MIN_VIDEO_ANIM_FRAMES,
  VIDEO_ANIM_DELAY_MS,
  VIDEO_ANIM_MAX_PX,
} from './videoAnim'

// テスト用のコマ。クライアントが canvas から出すのと同じ JPEG にする。
async function frame(
  width: number,
  height: number,
  shade: number,
): Promise<Uint8Array> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: shade, g: 200 - shade, b: 120 },
    },
  })
    .jpeg()
    .toBuffer()
  return new Uint8Array(buffer)
}

async function frames(count: number, width = 640, height = 360): Promise<Uint8Array[]> {
  return Promise.all(
    Array.from({ length: count }, (_, i) => frame(width, height, i * 20)),
  )
}

// 一様乱数のコマ。webp の圧縮がまるで効かないため、出来上がりが上限バイトを
// 超える入力 (= 採用してはいけないアニメ) を作れる。
//
// 既定を出力と同じ 320x320 にしてあるのは、縮小が入るとノイズが平均化されて
// 圧縮が効いてしまうため。この大きさが「出力寸法で取りうる最大の情報量」= 最悪
// ケースになる (実測 8 コマで約 350KB)。
async function noisyFrames(count: number, width = 320, height = 320): Promise<Uint8Array[]> {
  return Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const raw = Buffer.alloc(width * height * 3)
      let seed = i + 1
      for (let p = 0; p < raw.length; p++) {
        // xorshift。Math.random を使わないのは、失敗が再現する形にするため
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        raw[p] = seed & 0xff
      }
      const buffer = await sharp(raw, { raw: { width, height, channels: 3 } })
        .jpeg({ quality: 100 })
        .toBuffer()
      return new Uint8Array(buffer)
    }),
  )
}

test('複数のコマからアニメーション WebP を作る', async () => {
  const anim = await makeVideoAnim(await frames(8))

  expect(anim).not.toBeNull()
  const meta = await sharp(anim!).metadata()
  expect(meta.format).toBe('webp')
  expect(meta.pages).toBe(8)
})

test('出来上がりに ANIM チャンクが入る (静止画になっていない)', async () => {
  // 13-kick-work の実測で「rc=0 なのに 1 コマだけ」が約 300 件に 1 件出た。
  // 出来上がりを自分で検算する経路があることを、ここで担保する
  const anim = await makeVideoAnim(await frames(4))

  expect(isAnimatedWebp(anim!)).toBe(true)
})

test('VIDEO_ANIM_MAX_PX の箱に縦横比を保って収める', async () => {
  const anim = await makeVideoAnim(await frames(4, 1280, 640))

  const meta = await sharp(anim!).metadata()
  expect(meta.width).toBe(VIDEO_ANIM_MAX_PX)
  expect(meta.height).toBe(VIDEO_ANIM_MAX_PX / 2) // 1 コマぶんの高さ
})

test('元より小さいコマは拡大しない', async () => {
  const anim = await makeVideoAnim(await frames(4, 160, 120))

  const meta = await sharp(anim!).metadata()
  expect(meta.width).toBe(160)
  expect(meta.height).toBe(120)
})

test('コマ送りの間隔と無限ループを指定する', async () => {
  const anim = await makeVideoAnim(await frames(3))

  const meta = await sharp(anim!).metadata()
  expect(meta.delay).toEqual([
    VIDEO_ANIM_DELAY_MS,
    VIDEO_ANIM_DELAY_MS,
    VIDEO_ANIM_DELAY_MS,
  ])
  expect(meta.loop).toBe(0)
})

test('コマ数が MIN_VIDEO_ANIM_FRAMES に満たなければ null', async () => {
  // 2 コマ以下は「動くサムネ」として意味が無く、静止サムネで足りる
  expect(await makeVideoAnim(await frames(MIN_VIDEO_ANIM_FRAMES - 1))).toBeNull()
  expect(await makeVideoAnim([])).toBeNull()
})

test('MAX_VIDEO_ANIM_FRAMES を超えるコマは切り捨てる', async () => {
  // route が同じ上限で切ってから渡すが、入口が増えたときに素通ししないよう
  // ここでも頭打ちにする。断らず切り捨てるのは、余分なコマがあってもアニメ
  // としては成立するため
  const anim = await makeVideoAnim(await frames(MAX_VIDEO_ANIM_FRAMES + 4))

  const meta = await sharp(anim!).metadata()
  expect(meta.pages).toBe(MAX_VIDEO_ANIM_FRAMES)
})

test('寸法がばらばらのコマでも同じ寸法へ揃える', async () => {
  // sharp の join は寸法違いでもエラーにせず 1 コマ目に合わせて余白を入れる
  // (実測)。揃えずに渡すと、動かした瞬間に絵が飛び跳ねる
  const mixed = [
    await frame(640, 360, 10),
    await frame(320, 240, 60),
    await frame(800, 450, 120),
  ]

  const anim = await makeVideoAnim(mixed)

  const meta = await sharp(anim!).metadata()
  expect(meta.pages).toBe(3)
  expect(meta.width).toBe(VIDEO_ANIM_MAX_PX)
  expect(meta.height).toBe(180) // 1 コマ目 (16:9) の縮小後
})

test('画像でないバイト列が混ざったら null (例外を投げない)', async () => {
  // poster と同じ流儀 — 動くサムネは「あれば嬉しい派生物」なので、
  // これのためにアップロードを失敗させない
  const broken = [...(await frames(3)), new Uint8Array([1, 2, 3, 4])]

  expect(await makeVideoAnim(broken)).toBeNull()
})

test('展開すると巨大になるコマは断る (解凍爆弾よけ)', async () => {
  // 送信サイズの上限は展開後の大きさを縛らない。単色なら 12000x12000 (144MP) が
  // 数十 KB に収まってしまう
  const huge = await sharp({
    create: { width: 12000, height: 12000, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .jpeg()
    .toBuffer()
  const bomb = Array.from({ length: 3 }, () => new Uint8Array(huge))

  expect(await makeVideoAnim(bomb)).toBeNull()
})

test('出来上がりが MAX_VIDEO_ANIM_BYTES を超えたら null (静止のまま)', async () => {
  // 一覧を軽くするための差し替えが重くては本末転倒。捨てれば配信が 404 を返し、
  // 表示は静止サムネのままになる
  const anim = await makeVideoAnim(await noisyFrames(8))

  expect(anim).toBeNull()
})

test('作れたアニメは MAX_VIDEO_ANIM_BYTES に収まる', async () => {
  const anim = await makeVideoAnim(await frames(8))

  expect(anim!.byteLength).toBeLessThanOrEqual(MAX_VIDEO_ANIM_BYTES)
})

test('isAnimatedWebp: 静止 WebP は false', async () => {
  const still = await sharp({
    create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .webp()
    .toBuffer()

  expect(isAnimatedWebp(new Uint8Array(still))).toBe(false)
})

test('isAnimatedWebp: WebP でないバイト列は false', () => {
  expect(isAnimatedWebp(new Uint8Array([1, 2, 3, 4]))).toBe(false)
  expect(isAnimatedWebp(new Uint8Array(0))).toBe(false)
})
