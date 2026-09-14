import { describe, expect, test, vi } from 'vitest'

// 解凍爆弾よけの回帰テスト (security-reviewer 指摘 HIGH)。
// heic-decode の all() をモックし、「巨大寸法を名乗るが画素は確保していない」
// ハンドルを返させて、normalizeImage が decode() を呼ぶ前に弾くことを確かめる。
// 実ファイルを使う変換テストは images/normalizeImage.test.ts 側にあり、モジュールが
// ファイル単位で隔離される vitest ではこのモックの影響を受けない。
const decodeSpy = vi.fn(async () => ({
  width: 1,
  height: 1,
  data: new Uint8Array(4).buffer,
}))
const disposeSpy = vi.fn()

vi.mock('heic-decode', () => ({
  all: vi.fn(async () => {
    // 30000x30000 = 9 億 px (上限 5000 万 px を大きく超える)。one() なら
    // ここで ~3.6GB を確保してしまうが、all() は寸法だけ返す
    const list = [{ width: 30000, height: 30000, decode: decodeSpy }] as unknown as {
      dispose(): void
    } & Array<{ width: number; height: number; decode: () => Promise<unknown> }>
    list.dispose = disposeSpy
    return list
  }),
}))

const { normalizeImage } = await import('./normalizeImage')

describe('normalizeImage HEIC 解凍爆弾ガード', () => {
  test('巨大寸法を名乗る HEIC は decode() する前に弾く', async () => {
    const fakeHeic = new Uint8Array(16) // 中身は問わない (all をモック済み)

    await expect(normalizeImage(fakeHeic, 'heic')).rejects.toThrow(/画素数が大きすぎ/)
    // 画素確保 (decode) が一度も走っていないこと = 確保前に弾けている
    expect(decodeSpy).not.toHaveBeenCalled()
    // libheif の確保は解放する (finally の dispose)
    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })
})
