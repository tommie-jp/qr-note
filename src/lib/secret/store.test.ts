import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { PrismaClient } from '@/generated/prisma/client'
import type {
  deleteKeyring as DeleteKeyringFn,
  findKeyringVerifier as FindKeyringVerifierFn,
  findSecret as FindSecretFn,
  hasCredential as HasCredentialFn,
  initKeyring as InitKeyringFn,
  listKeyWraps as ListKeyWrapsFn,
  saveKeyWrap as SaveKeyWrapFn,
  saveSecret as SaveSecretFn,
} from './store'

// 断片と鍵束の読み書き (docs/51-部分暗号化計画.md §4, §6) を実 DB で確かめる。
// items/items.test.ts と同じ門: DATABASE_URL があり かつ RUN_DB_TESTS=1 のときだけ。
// db.ts はモジュール読み込み時に DATABASE_URL を要求するため、import は動的に行う
const runDbTests =
  !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === '1'

// **鍵束は主キー固定 (id=1) で 1 行しか持てない表**。手元の DB に本物の鍵束が
// あれば、それを消す・上書きする経路はテストでも絶対に踏まない (docs/96 §2-4)。
// describe.skipIf は収集時に評価されるので、探りは読み込み時に済ませておく
// (門を通るときだけ db.ts を読む)
const existingKeyringRows = runDbTests ? await countKeyringRows() : 0
const hasRealKeyring = existingKeyringRows > 0
if (hasRealKeyring) {
  // console.warn ではなく stderr へ直に書く。vitest の既定の reporter は、全部
  // skip になったファイルの console 出力を落とすので、理由が見えなくなる
  process.stderr.write(
    `secret_keyring に既に ${existingKeyringRows} 行あるため store.test.ts は skip する (本物の鍵束には触らない)\n`,
  )
}

async function countKeyringRows(): Promise<number> {
  const { prisma } = await import('@/lib/db')
  return prisma.secretKeyring.count()
}

// 実データと衝突しないよう、パスキーの行は "zzft" プレフィックスで作って後始末で消す
const CRED_PREFIX = 'zzft-secret-cred'
const CRED_OLD = `${CRED_PREFIX}-1`
const CRED_NEW = `${CRED_PREFIX}-2`
const CRED_UNKNOWN = `${CRED_PREFIX}-nope`

// 断片の名前は UUID の書式しか通らず (secrets.ts の isValidSecretName)、zzft を
// 含められない。固定の v4 UUID を 1 つ決めて使い、後始末で消す
const SECRET_NAME = '3f2c9d1e-5b7a-4c8d-9e0f-1a2b3c4d5e6f'
// 一度も保存しない名前 (「無い」を見るため)
const MISSING_NAME = '3f2c9d1e-5b7a-4c8d-9e0f-000000000000'

// 鍵束の検証値 (中身は見ないので固定のダミー)。**後始末で消してよい鍵束か**を
// この値で見分ける — 自分が作った行だけを消し、本物の鍵束は絶対に消さない
const TEST_VERIFIER = new Uint8Array([0x7a, 0x7a, 0x66, 0x74, 1, 2, 3])
const OTHER_VERIFIER = new Uint8Array([0x7a, 0x7a, 0x66, 0x74, 9, 9, 9])

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i])

const isTestVerifier = (verifier: Uint8Array) =>
  sameBytes(verifier, TEST_VERIFIER) || sameBytes(verifier, OTHER_VERIFIER)

const owned = (values: number[]): Uint8Array<ArrayBuffer> => Uint8Array.from(values)

describe.skipIf(!runDbTests || hasRealKeyring)(
  'secret/store (integration; needs DATABASE_URL + RUN_DB_TESTS=1 + 鍵束 0 行)',
  () => {
    let findSecret: typeof FindSecretFn
    let saveSecret: typeof SaveSecretFn
    let findKeyringVerifier: typeof FindKeyringVerifierFn
    let initKeyring: typeof InitKeyringFn
    let deleteKeyring: typeof DeleteKeyringFn
    let listKeyWraps: typeof ListKeyWrapsFn
    let hasCredential: typeof HasCredentialFn
    let saveKeyWrap: typeof SaveKeyWrapFn
    let prisma: PrismaClient

    async function removeTestRows(): Promise<void> {
      await prisma.secret.deleteMany({ where: { name: { in: [SECRET_NAME, MISSING_NAME] } } })
      await prisma.webAuthnCredential.deleteMany({
        where: { id: { startsWith: CRED_PREFIX } },
      })
      // 鍵束は自分の検証値のときだけ消す
      const keyring = await prisma.secretKeyring.findUnique({
        where: { id: 1 },
        select: { verifier: true },
      })
      if (keyring !== null && isTestVerifier(new Uint8Array(keyring.verifier))) {
        await prisma.secretKeyring.deleteMany({ where: { id: 1 } })
      }
    }

    beforeAll(async () => {
      ;({
        findSecret,
        saveSecret,
        findKeyringVerifier,
        initKeyring,
        deleteKeyring,
        listKeyWraps,
        hasCredential,
        saveKeyWrap,
      } = await import('./store'))
      ;({ prisma } = await import('@/lib/db'))
      await removeTestRows()
      // createdAt 順で返ることを見るため、id の並びと逆の順で古い方を作る
      await prisma.webAuthnCredential.createMany({
        data: [
          {
            id: CRED_OLD,
            userName: 'zzft',
            publicKey: owned([1, 2, 3]),
            label: 'zzft 後から登録',
            createdAt: new Date('2026-01-02T00:00:00Z'),
          },
          {
            id: CRED_NEW,
            userName: 'zzft',
            publicKey: owned([4, 5, 6]),
            label: 'zzft 先に登録',
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
        ],
      })
    })

    afterAll(async () => {
      if (!prisma) return
      await removeTestRows()
      await prisma.$disconnect()
    })

    describe('断片 (secrets)', () => {
      test('無い名前は null', async () => {
        expect(await findSecret(MISSING_NAME)).toBe(null)
      })

      test('保存すると種別と暗号文がそのまま読める', async () => {
        // Arrange
        const data = owned([1, 12, 0, 255, 7])

        // Act
        await saveSecret(SECRET_NAME, 'text/markdown', data)
        const stored = await findSecret(SECRET_NAME)

        // Assert
        expect(stored?.mime).toBe('text/markdown')
        expect(stored?.data).toBeInstanceOf(Uint8Array)
        expect(Array.from(stored?.data ?? [])).toEqual([1, 12, 0, 255, 7])
      })

      // 編集は同名で上書き (新しい UUID にしない)。配信が no-store なので
      // 古いキャッシュの問題が無く、本文のトークンが変わらないため
      test('同名で保存し直すと上書きになる (種別も入れ替わる)', async () => {
        // Arrange
        await saveSecret(SECRET_NAME, 'text/markdown', owned([1, 2, 3]))

        // Act
        await saveSecret(SECRET_NAME, 'image/webp', owned([9, 8]))
        const stored = await findSecret(SECRET_NAME)

        // Assert
        expect(stored?.mime).toBe('image/webp')
        expect(Array.from(stored?.data ?? [])).toEqual([9, 8])
        expect(await prisma.secret.count({ where: { name: SECRET_NAME } })).toBe(1)
      })
    })

    describe('鍵束 (secret_keyring)', () => {
      test('未設定なら検証値は null', async () => {
        expect(await findKeyringVerifier()).toBe(null)
      })

      test('初期化は 1 回だけ通り、2 回目は false で検証値を上書きしない', async () => {
        // Act
        const first = await initKeyring(owned(Array.from(TEST_VERIFIER)))
        const stored = await findKeyringVerifier()
        const second = await initKeyring(owned(Array.from(OTHER_VERIFIER)))
        const afterSecond = await findKeyringVerifier()

        // Assert — 主キー衝突だけを false に畳む (上書きすると既存の断片が全部読めなくなる)
        expect(first).toBe(true)
        expect(Array.from(stored ?? [])).toEqual(Array.from(TEST_VERIFIER))
        expect(second).toBe(false)
        expect(Array.from(afterSecond ?? [])).toEqual(Array.from(TEST_VERIFIER))
      })

      test('消すと null に戻る (初回設定の巻き戻し)', async () => {
        // Arrange — 前のテストが作った鍵束が無ければ作る
        await initKeyring(owned(Array.from(TEST_VERIFIER)))

        // Act
        await deleteKeyring()

        // Assert
        expect(await findKeyringVerifier()).toBe(null)
      })
    })

    describe('パスキーの包み (webauthn_credentials.secret_key_wrap)', () => {
      const mine = async () =>
        (await listKeyWraps()).filter((wrap) => wrap.credentialId.startsWith(CRED_PREFIX))

      test('hasCredential は登録済みなら true、知らない ID なら false', async () => {
        expect(await hasCredential(CRED_OLD)).toBe(true)
        expect(await hasCredential(CRED_UNKNOWN)).toBe(false)
      })

      test('知らない ID の包みは保存せず false (鍵だけが宙に浮かない)', async () => {
        // Act
        const saved = await saveKeyWrap(CRED_UNKNOWN, owned([1]))

        // Assert
        expect(saved).toBe(false)
        expect(await prisma.webAuthnCredential.count({ where: { id: CRED_UNKNOWN } })).toBe(0)
      })

      test('登録済みの ID なら true で、一覧に包みが載る (createdAt 順、無い方は null)', async () => {
        // Arrange
        const wrapped = owned([0x01, 0xaa, 0xbb, 0xcc])

        // Act
        const saved = await saveKeyWrap(CRED_OLD, wrapped)
        const wraps = await mine()

        // Assert — 先に登録した (createdAt が古い) 方が先。id の並びではない
        expect(saved).toBe(true)
        expect(wraps.map((wrap) => wrap.credentialId)).toEqual([CRED_NEW, CRED_OLD])
        expect(wraps.map((wrap) => wrap.label)).toEqual(['zzft 先に登録', 'zzft 後から登録'])
        expect(wraps[1].wrapped).toBeInstanceOf(Uint8Array)
        expect(Array.from(wraps[1].wrapped ?? [])).toEqual([0x01, 0xaa, 0xbb, 0xcc])
        expect(wraps[0].wrapped).toBe(null)
      })

      test('同じ ID に保存し直すと包みが入れ替わる', async () => {
        // Arrange
        await saveKeyWrap(CRED_OLD, owned([1, 1, 1]))

        // Act
        await saveKeyWrap(CRED_OLD, owned([2, 2]))
        const wraps = await mine()

        // Assert
        const old = wraps.find((wrap) => wrap.credentialId === CRED_OLD)
        expect(Array.from(old?.wrapped ?? [])).toEqual([2, 2])
      })
    })
  },
)
