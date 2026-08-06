// シークレット断片の暗号エンベロープ (docs/51-部分暗号化計画.md §7)。
//
// 平文をこの形へ包んでから送る。サーバはこのバイト列しか受け取らず、鍵は
// クライアントのメモリにしかない。
//
//   version(1) || iv(12) || AES-256-GCM の暗号文 + タグ(16)
//
// **AAD (追加認証データ) に「文脈」を入れるのが要点**。GCM は中身の改竄を
// 検知するが、断片 A と断片 B を丸ごと入れ替えるすり替えは検知できない
// (「銀行のパスワード」の欄に別の値が表示される)。文脈として断片の名前を
// 縛っておけば、すり替えは復号失敗になる。鍵のラップ (secretKeyring.ts) も
// 同じ仕組みでクレデンシャル ID に縛る。
//
// WebCrypto しか使わないので、ブラウザ・Node (テスト) の両方で動く。

import { ownedBytes } from './bytes'

export const ENVELOPE_VERSION = 1

const IV_BYTES = 12
// GCM の認証タグ。version + iv + タグ より短い入力は中身を持ちえない
const TAG_BYTES = 16
const HEADER_BYTES = 1 + IV_BYTES

// 復号できなかった。**理由は区別しない** — 鍵違い・すり替え・改竄・切り詰めの
// どれであっても、呼ぶ側にできることは同じ (中身を出さない) ため。
export class SecretDecryptError extends Error {
  // 元の例外は cause に残す。利用者向けの文言は変えないまま、開発側だけが
  // 「WebCrypto の復号失敗」と「引数の取り違えで TypeError が出た」を
  // 見分けられるようにするため
  constructor(message = 'シークレットを復号できませんでした', options?: ErrorOptions) {
    super(message, options)
    this.name = 'SecretDecryptError'
  }
}

// 32 バイトの鍵素材を AES-256-GCM の鍵にする。
// マスターキー (断片の暗号化) と KEK (鍵のラップ) の両方がこれを使う。
export async function importContentKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', ownedBytes(raw), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

// 平文を包む。iv は毎回作り直す (同じ鍵で同じ iv を再利用すると GCM は破れる)。
export async function sealSecret(
  key: CryptoKey,
  plaintext: Uint8Array,
  context: string,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))

  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: contextBytes(context) },
      key,
      ownedBytes(plaintext),
    ),
  )

  const envelope = new Uint8Array(HEADER_BYTES + sealed.byteLength)
  envelope[0] = ENVELOPE_VERSION
  envelope.set(iv, 1)
  envelope.set(sealed, HEADER_BYTES)
  return envelope
}

// 包みを開く。開けなければ必ず SecretDecryptError を投げる (null を返さない —
// 「復号できなかった」を握り潰して空文字を表示するのが一番まずい)。
export async function openSecret(
  key: CryptoKey,
  envelope: Uint8Array,
  context: string,
): Promise<Uint8Array> {
  if (envelope.byteLength <= HEADER_BYTES + TAG_BYTES - 1) {
    throw new SecretDecryptError()
  }
  if (envelope[0] !== ENVELOPE_VERSION) {
    // 将来の形式を古いクライアントが「壊れている」と誤って上書きしないよう、
    // 版が違えば必ず断る
    throw new SecretDecryptError(
      'このシークレットは新しい形式です。アプリを更新してください',
    )
  }

  const iv = ownedBytes(envelope.subarray(1, HEADER_BYTES))
  const body = ownedBytes(envelope.subarray(HEADER_BYTES))

  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: contextBytes(context) },
        key,
        body,
      ),
    )
  } catch (cause) {
    throw new SecretDecryptError(undefined, { cause })
  }
}

function contextBytes(context: string): Uint8Array<ArrayBuffer> {
  return ownedBytes(new TextEncoder().encode(context))
}
