// シークレットの鍵まわり (docs/51-部分暗号化計画.md §6)。
//
// 断片そのものを暗号化するのは**マスターキー (MK)** 1 本だけ。パスキーの PRF
// 出力から作る鍵 (KEK) は MK を包むためだけに使う。
//
//   パスキー (PRF) → HKDF → KEK → KEK で MK をラップ → サーバに保存
//   断片 → MK で AES-256-GCM
//
// PRF 出力は**クレデンシャルごとに違う** (端末ごとではない — iCloud 同期された
// パスキーはどの端末でも同じ値になる)。MK を挟むことで、パスキーを足しても
// 失っても既存の断片が読めなくならない。復旧キーは MK そのものの base32 印字で、
// パスキーを全部失ったときの最後の入口になる。
//
// WebCrypto しか使わないので、ブラウザ・Node (テスト) の両方で動く。

import { ownedBytes } from './bytes'
import {
  SecretDecryptError,
  importContentKey,
  openSecret,
  sealSecret,
} from './secretEnvelope'

// 認証器へ渡す PRF の salt。**変えてはいけない** — 変えると PRF 出力が変わり、
// 保存済みのラップが開けなくなる (復旧キーからやり直しになる)。
//
// 下の 3 つに残る `qr-search` は表示名ではなく**暗号の定数**。アプリ名を
// QR Note へ改めた後もこの綴りで据え置く (改名の一括置換に巻き込まない)。
export const PRF_SALT = ownedBytes(new TextEncoder().encode('qr-search-secret-v1'))

// HKDF の info。salt と同じく固定値
const KEK_INFO = new TextEncoder().encode('qr-search-kek-v1')

// 検証値の中身。MK が正しいことを確かめるためだけの既知平文
const VERIFIER_PLAINTEXT = new TextEncoder().encode('qr-search-secret-keyring')

const MASTER_KEY_BYTES = 32

// AAD の文脈文字列 (secretEnvelope.ts)。用途ごとに分けることで、鍵のラップを
// 断片として復号させるような取り違えも防ぐ
const VERIFIER_CONTEXT = 'keyring-verifier'
const wrapContext = (credentialId: string) => `keyring-wrap:${credentialId}`

// 新しいマスターキーを作る。**一度きり**で、以後は復旧キーとラップからしか
// 手に入らない
export function generateMasterKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(MASTER_KEY_BYTES))
}

// 認証器の PRF 出力 (32 バイト) から KEK を導く。
// 同じパスキー + 同じ salt なら常に同じ鍵になる。
export async function deriveKek(prfOutput: Uint8Array): Promise<CryptoKey> {
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    ownedBytes(prfOutput),
    'HKDF',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      // PRF 出力自体が高エントロピーなので salt は空でよい (HKDF の salt は
      // 低エントロピーな入力を散らすためのもの)。info で用途を分ける
      salt: new Uint8Array(0),
      info: KEK_INFO,
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// MK を KEK で包む。**クレデンシャル ID に縛る** (別の端末のラップを持ってきて
// すり替えても開かない)。
export async function wrapMasterKey(
  kek: CryptoKey,
  masterKey: Uint8Array,
  credentialId: string,
): Promise<Uint8Array> {
  return sealSecret(kek, masterKey, wrapContext(credentialId))
}

export async function unwrapMasterKey(
  kek: CryptoKey,
  wrapped: Uint8Array,
  credentialId: string,
): Promise<Uint8Array> {
  const raw = await openSecret(kek, wrapped, wrapContext(credentialId))
  if (raw.byteLength !== MASTER_KEY_BYTES) {
    // 開けはしたが中身が鍵の長さでない = 想定外。黙って使わない。
    // **利用者向けの文言は変えず、開発者向けの手掛かりだけ残す** — ここは
    // 「鍵が違う」ではなく保存されている値の異常なので、区別が付かないと
    // 追えなくなる
    console.error(
      `包んだ鍵の長さが違います (${raw.byteLength} バイト, 期待 ${MASTER_KEY_BYTES})`,
    )
    throw new SecretDecryptError()
  }
  return raw
}

// 「この MK で合っているか」を確かめるためだけの値。復旧キーを打ち込んだときの
// 検算に使う (断片が 1 つも無くても確かめられるようにするため)。
export async function makeVerifier(masterKey: Uint8Array): Promise<Uint8Array> {
  return sealSecret(
    await importContentKey(masterKey),
    VERIFIER_PLAINTEXT,
    VERIFIER_CONTEXT,
  )
}

// 検証値と噛み合う MK か。**投げない** — 打ち間違いは例外ではなく想定内なので、
// 呼ぶ側が真偽で分岐できるようにする。
export async function checkVerifier(
  masterKey: Uint8Array,
  verifier: Uint8Array,
): Promise<boolean> {
  try {
    const opened = await openSecret(
      await importContentKey(masterKey),
      verifier,
      VERIFIER_CONTEXT,
    )
    return (
      opened.byteLength === VERIFIER_PLAINTEXT.byteLength &&
      opened.every((byte, i) => byte === VERIFIER_PLAINTEXT[i])
    )
  } catch (cause) {
    // 復号できない = 鍵が違う (打ち間違い) なので、これは想定内で黙ってよい。
    // **それ以外の例外まで同じ false に丸めない** — コードの不具合や壊れた
    // 検証値まで「復旧キーが違います」になると、何度打ち直しても直らない
    // 状態を利用者の入力ミスとして片付けてしまう
    if (!(cause instanceof SecretDecryptError)) {
      console.error('検証値の照合に失敗しました', cause)
    }
    return false
  }
}

// --- 復旧キー (紙に印字する MK) ---
//
// Crockford の base32。**I・L・O・U を含まない**ので、手で書き写して打ち直す
// ときに 1/I/l や 0/O を取り違えても復号側で吸収できる。
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

// 32 バイト = 256 bit を 5 bit ずつ → 52 文字 (末尾 4 bit は詰め物)
export const RECOVERY_KEY_LENGTH = Math.ceil((MASTER_KEY_BYTES * 8) / 5)

// 印字するときの区切り。4 文字ごとにハイフンを入れる
const GROUP_SIZE = 4

export function encodeRecoveryKey(masterKey: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of masterKey) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31]
  }
  return out
}

// 紙に書く形。読み上げ・書き写しのために 4 文字ずつ区切る
export function formatRecoveryKey(encoded: string): string {
  const groups: string[] = []
  for (let at = 0; at < encoded.length; at += GROUP_SIZE) {
    groups.push(encoded.slice(at, at + GROUP_SIZE))
  }
  return groups.join('-')
}

// 打ち込まれた文字列を MK に戻す。書式が違えば null (投げない)。
//
// 区切り・空白・大文字小文字は問わない。O→0 / I・L→1 の取り違えも吸収する
// (Crockford base32 の作法)。
export function decodeRecoveryKey(input: string): Uint8Array | null {
  const cleaned = input
    .replace(/[\s-]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')

  if (cleaned.length !== RECOVERY_KEY_LENGTH) {
    return null
  }

  const out = new Uint8Array(MASTER_KEY_BYTES)
  let bits = 0
  let value = 0
  let at = 0
  for (const char of cleaned) {
    const index = ALPHABET.indexOf(char)
    if (index < 0) {
      return null
    }
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out[at++] = (value >>> (bits - 8)) & 0xff
      bits -= 8
    }
  }
  return at === MASTER_KEY_BYTES ? out : null
}
