import sharp from 'sharp'
import { expect, test } from 'vitest'
import {
  canAnimateThumbnail,
  makeThumbnail,
  MAX_ANIMATION_FRAMES,
  MAX_INPUT_PIXELS,
  THUMB_MAX_PX,
  THUMB_MIME,
} from './thumbnail'

// テスト用の単色画像。中身は問わないので生成で済ませる (固定ファイルを置かない)。
async function png(width: number, height: number): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer()
  return new Uint8Array(buffer)
}

// テスト用のアニメ GIF (frames 枚)。色違いのフレームを join でアニメ化する
async function animatedGif(
  width: number,
  height: number,
  frames = 3,
): Promise<Uint8Array> {
  const colors = [
    { r: 200, g: 30, b: 30 },
    { r: 30, g: 200, b: 30 },
    { r: 30, g: 30, b: 200 },
  ]
  const pages = await Promise.all(
    Array.from({ length: frames }, (_, i) =>
      sharp({
        create: { width, height, channels: 3, background: colors[i % colors.length] },
      })
        .png()
        .toBuffer(),
    ),
  )
  const buffer = await sharp(pages, {
    join: { animated: true },
  })
    .gif()
    .toBuffer()
  return new Uint8Array(buffer)
}

// ノイズのアニメ GIF。単色と違って圧縮が効かないため、アニメ webp のサムネが
// 原寸より重くなる (= サムネとして採用してはいけない入力) を作れる
async function noisyAnimatedGif(
  width: number,
  height: number,
  frames: number,
): Promise<Uint8Array> {
  const pages = await Promise.all(
    Array.from({ length: frames }, (_, i) => {
      const raw = Buffer.alloc(width * height * 3)
      for (let p = 0; p < raw.length; p++) {
        raw[p] = (p * 2654435761 + i * 40503) % 251
      }
      return sharp(raw, { raw: { width, height, channels: 3 } })
        .png()
        .toBuffer()
    }),
  )
  const buffer = await sharp(pages, { join: { animated: true } })
    .gif()
    .toBuffer()
  return new Uint8Array(buffer)
}

test('大きい画像は縦横比を保ったまま THUMB_MAX_PX の箱に収める', async () => {
  // 画像モードのタイルは object-contain で全体を見せるので、切り抜かず
  // 縦横比を保つ (fit: 'inside')。2:1 の絵は長辺が一辺に収まり、短辺は半分
  // になる (docs/32 §1)
  const thumb = await makeThumbnail(await png(2000, 1000))

  const meta = await sharp(thumb!).metadata()
  expect(meta.width).toBe(THUMB_MAX_PX)
  expect(meta.height).toBe(THUMB_MAX_PX / 2)
})

test('THUMB_MIME の形式で返す', async () => {
  const thumb = await makeThumbnail(await png(2000, 1000))

  const meta = await sharp(thumb!).metadata()
  expect(`image/${meta.format}`).toBe(THUMB_MIME)
})

test('元より小さい画像は拡大しない', async () => {
  const thumb = await makeThumbnail(await png(80, 60))

  const meta = await sharp(thumb!).metadata()
  expect(meta.width).toBe(80)
  expect(meta.height).toBe(60)
})

test('一覧に並べられる大きさまで小さくなる', async () => {
  // 縮小が効いていることの確認。原寸のまま配ると一覧が実用にならないのが
  // この列を足した理由なので、バイト数そのものを見る
  const original = await png(3000, 2000)
  const thumb = await makeThumbnail(original)

  expect(thumb!.byteLength).toBeLessThan(original.byteLength)
  expect(thumb!.byteLength).toBeLessThan(100 * 1024)
})

test('EXIF の向きを反映して起こす', async () => {
  // スマホ写真は横倒しのまま保存され、向きは EXIF にしか入っていない。
  // orientation 6 = 時計回り 90 度で表示する指定なので、縦横が入れ替わる。
  // 縮小が絡まない大きさ (回転後も THUMB_MAX_PX 以内) で向きだけを見る
  const buffer = await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer()

  const thumb = await makeThumbnail(new Uint8Array(buffer))

  const meta = await sharp(thumb!).metadata()
  expect(meta.width).toBe(100)
  expect(meta.height).toBe(200)
})

test('アニメ GIF はサムネもアニメ (全フレームを保つ) にする', async () => {
  // 一覧で GIF を動かすため、複数ページの入力はサムネも複数ページで返す
  const thumb = await makeThumbnail(await animatedGif(120, 90, 3))

  const meta = await sharp(thumb!).metadata()
  expect(`image/${meta.format}`).toBe(THUMB_MIME) // 静止と同じ webp
  expect(meta.pages).toBe(3) // フレームが失われていない = アニメのまま
})

test('アニメ GIF も箱に収まるまで縮小する (縦横比維持)', async () => {
  // 各フレームを縮小する。2:1 なら長辺が一辺、短辺は半分
  const thumb = await makeThumbnail(await animatedGif(1000, 500, 2))

  const meta = await sharp(thumb!).metadata()
  expect(meta.width).toBe(THUMB_MAX_PX)
  expect(meta.height).toBe(THUMB_MAX_PX / 2) // 1 フレームの高さ
  expect(meta.pages).toBe(2) // フレーム数は保つ
})

test('静止画は従来どおり単一フレーム (アニメにしない)', async () => {
  const thumb = await makeThumbnail(await png(400, 300))

  const meta = await sharp(thumb!).metadata()
  // 単一ページは pages を持たない (1 か undefined)
  expect(meta.pages ?? 1).toBe(1)
})

test('フレーム数が多すぎるアニメは静止サムネに落とす (null にしない)', async () => {
  // コマ数に比例して生成時間と出力バイトが伸びる。上限を超えたら諦めるが、
  // 諦め先は「サムネなし」ではなく静止サムネ (一覧が原寸を配らないように)
  const thumb = await makeThumbnail(
    await animatedGif(40, 30, MAX_ANIMATION_FRAMES + 1),
  )

  expect(thumb).not.toBeNull()
  const meta = await sharp(thumb!).metadata()
  expect(meta.pages ?? 1).toBe(1)
})

test('展開後が上限を超えるアニメでも静止サムネは作る', async () => {
  // animated: true は全フレームを縦に連結して 1 枚として扱うため、解凍爆弾よけ
  // (MAX_INPUT_PIXELS) がフレーム**合計**に掛かる。素通しするとサムネが
  // 丸ごと作られず、一覧が原寸の GIF を配ることになる (静止サムネなら作れる)
  const thumb = await makeThumbnail(await animatedGif(5100, 5100, 2))

  expect(thumb).not.toBeNull()
  const meta = await sharp(thumb!).metadata()
  expect(meta.width).toBe(THUMB_MAX_PX)
  expect(meta.pages ?? 1).toBe(1)
})

test('アニメサムネが原寸より重くなるときは静止サムネにする', async () => {
  // 縮めるためのサムネが原寸を上回っては本末転倒 (一覧が原寸より重くなる)
  const bytes = await noisyAnimatedGif(120, 90, 60)
  const thumb = await makeThumbnail(bytes)

  expect(thumb).not.toBeNull()
  expect(thumb!.byteLength).toBeLessThan(bytes.byteLength)
  const meta = await sharp(thumb!).metadata()
  expect(meta.pages ?? 1).toBe(1)
})

test('画像でないバイト列では null を返す (呼び出し側を失敗させない)', async () => {
  expect(await makeThumbnail(new Uint8Array([1, 2, 3, 4]))).toBeNull()
})

test('展開すると巨大になる画像は断る (解凍爆弾よけ)', async () => {
  // バイト数の上限は展開後の大きさを縛らない。単色なら 12000x12000 (144MP) が
  // 数十 KB に収まってしまうので、10MB 制限をすり抜けてメモリを潰せる。
  // 断るときも例外ではなく null (アップロード自体は成功させる)
  const huge = await sharp({
    create: { width: 12000, height: 12000, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png({ compressionLevel: 9 })
    .toBuffer()

  expect(await makeThumbnail(new Uint8Array(huge))).toBeNull()
})

test('canAnimateThumbnail: 単一ページ (静止画) はアニメにしない', () => {
  expect(canAnimateThumbnail(1, 1_000)).toBe(false)
})

test('canAnimateThumbnail: 上限内の複数ページはアニメにする', () => {
  expect(canAnimateThumbnail(3, 1_000)).toBe(true)
  expect(canAnimateThumbnail(MAX_ANIMATION_FRAMES, 1_000)).toBe(true)
})

test('canAnimateThumbnail: フレーム数が上限を超えたらアニメにしない', () => {
  expect(canAnimateThumbnail(MAX_ANIMATION_FRAMES + 1, 1_000)).toBe(false)
})

test('canAnimateThumbnail: 展開後の合計が解凍爆弾よけを超えたらアニメにしない', () => {
  // 1 フレームは上限内でも、合計 (フレーム数 x 1 フレーム) で超える入力がある
  expect(canAnimateThumbnail(2, MAX_INPUT_PIXELS)).toBe(false)
  expect(canAnimateThumbnail(2, MAX_INPUT_PIXELS / 2)).toBe(true)
})
