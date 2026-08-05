import { describe, expect, test } from 'vitest'
import { secretContext } from './secretContent'
import {
  SecretDecryptError,
  importContentKey,
  openSecret,
  sealSecret,
} from './secretEnvelope'
import { SECRET_TEXT_MIME } from './secretPayload'

const NAME = '0123abcd-4567-89ab-cdef-0123456789ab'
const OTHER = 'fedcba98-7654-3210-fedc-ba9876543210'

const key = () => importContentKey(new Uint8Array(32).fill(3))

// 断片の AAD は「名前 + 復号後の種別」。mime は暗号化しないメタデータなので、
// DB に書ける相手は data をそのままに mime だけを書き換えられる。両方を
// 縛っていないと、そのすり替えが復号成功として通ってしまう (docs/51 §7)。
describe('secretContext', () => {
  test('a blob keeps opening under its own name and mime', async () => {
    const k = await key()
    const context = secretContext(NAME, SECRET_TEXT_MIME)
    const sealed = await sealSecret(k, new Uint8Array([1, 2, 3]), context)
    expect(Array.from(await openSecret(k, sealed, context))).toEqual([1, 2, 3])
  })

  test('rejects a blob whose mime was swapped (画像を markdown と偽る)', async () => {
    const k = await key()
    const sealed = await sealSecret(
      k,
      new Uint8Array([1, 2, 3]),
      secretContext(NAME, 'image/png'),
    )
    await expect(
      openSecret(k, sealed, secretContext(NAME, SECRET_TEXT_MIME)),
    ).rejects.toBeInstanceOf(SecretDecryptError)
  })

  test('rejects a blob whose name was swapped', async () => {
    const k = await key()
    const sealed = await sealSecret(
      k,
      new Uint8Array([1, 2, 3]),
      secretContext(NAME, SECRET_TEXT_MIME),
    )
    await expect(
      openSecret(k, sealed, secretContext(OTHER, SECRET_TEXT_MIME)),
    ).rejects.toBeInstanceOf(SecretDecryptError)
  })
})
