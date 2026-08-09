import { beforeEach, describe, expect, test, vi } from 'vitest'

import { loadKeyringCache, saveKeyringCache } from './keyring'

// IndexedDB は node には無い。ここで見たいのは**読み直しの検算**であって
// 保存そのものではないので、置き場は 1 レコードの Map で足りる
const store = new Map<string, unknown>()

vi.mock('./idb', () => ({
  getRecord: (_name: string, key: string) => Promise.resolve(store.get(key)),
  putRecord: (_name: string, key: string, value: unknown) => {
    store.set(key, value)
    return Promise.resolve()
  },
  deleteRecord: (_name: string, key: string) => {
    store.delete(key)
    return Promise.resolve()
  },
}))

const WRAPPED = new Uint8Array([1, 2, 3])
const VERIFIER = new Uint8Array([9, 9])

function keyring(over: Record<string, unknown> = {}) {
  return {
    initialized: true,
    verifier: VERIFIER,
    wraps: [{ credentialId: 'cred-1', label: 'iPhone', wrapped: WRAPPED }],
    ...over,
  }
}

beforeEach(() => {
  store.clear()
})

describe('鍵束の写し', () => {
  test('保存した鍵束をそのまま読み直せる', async () => {
    // Arrange
    await saveKeyringCache(keyring())

    // Act
    const loaded = await loadKeyringCache()

    // Assert
    expect(loaded?.initialized).toBe(true)
    expect(loaded?.verifier).toEqual(VERIFIER)
    expect(loaded?.wraps[0].wrapped).toEqual(WRAPPED)
  })

  test('写しが無ければ null (まだオンラインで読んでいない)', async () => {
    expect(await loadKeyringCache()).toBeNull()
  })

  // まだ設定していない状態は正常。null を「壊れている」と混同すると、
  // 設定画面へ案内すべき場面で「圏外です」と言うことになる
  test('未設定 (verifier も包みも null) は正常な写しとして読む', async () => {
    // Arrange
    store.set('state', {
      initialized: false,
      verifier: null,
      wraps: [{ credentialId: 'cred-1', label: 'iPhone', wrapped: null }],
    })

    // Act
    const loaded = await loadKeyringCache()

    // Assert
    expect(loaded?.initialized).toBe(false)
    expect(loaded?.wraps[0].wrapped).toBeNull()
  })

  test('形の違う写しは null にする', async () => {
    for (const broken of [
      null,
      'state',
      keyring({ initialized: 'yes' }),
      keyring({ wraps: 'none' }),
      // base64 のまま入っている (古い版が書いた形)
      keyring({ verifier: 'AAAA' }),
      // 空の包みは開けない
      keyring({ wraps: [{ credentialId: 'c', label: 'l', wrapped: new Uint8Array() }] }),
    ]) {
      store.set('state', broken)
      expect(await loadKeyringCache()).toBeNull()
    }
  })

  // 落とした 1 つが「いま手元にある唯一のパスキーの包み」だったとき、黙って
  // 落とすと「このパスキーでは有効になっていません」という的外れな案内になる
  test('包みが 1 つでも読めなければ写しごと捨てる', async () => {
    // Arrange
    store.set(
      'state',
      keyring({
        wraps: [
          { credentialId: 'cred-1', label: 'iPhone', wrapped: WRAPPED },
          { credentialId: 42, label: 'PC', wrapped: WRAPPED },
        ],
      }),
    )

    // Act & Assert
    expect(await loadKeyringCache()).toBeNull()
  })
})
