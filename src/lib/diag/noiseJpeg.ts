// ベンチの材料のノイズ画像 (docs/121 §3)。DB に依らない葉 — 重い処理の
// ピーク計測 (scripts/peakMemoryTask.ts) も DATABASE_URL 無しで使う
import sharp from 'sharp'

// 決まった模様のノイズ画像 (JPEG)。ノイズにするのは、平らな画像だと縮小も
// 圧縮も一瞬で終わり、写真の重さにならないため。乱数を固定の種で作るので
// 毎回同じ材料になる
export async function makeNoiseJpeg(width: number, height: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3)
  let seed = 0x2545f491
  for (let i = 0; i < raw.length; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    // 斜めの濃淡 + 小さなノイズ (写真に近い圧縮率にする)
    const x = Math.floor(i / 3) % width
    const y = Math.floor(i / 3 / width)
    raw[i] = ((x + y) / 8 + (seed >>> 27)) & 0xff
  }
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer())
}
