// バイト列と base64 の相互変換 (ブラウザ・Node の両方で動く)。
//
// シークレットの鍵まわり (包んだマスターキー・検証値) を JSON で運ぶために使う。
// Buffer は Node にしかなく、鍵の組み立てはブラウザ側でも行うため、
// どちらにもある btoa / atob を使う。
//
// 断片そのもの (数 MB) はここを通さない — base64 は 33% 太るので、
// application/octet-stream で生のまま送る (src/app/api/secrets)。

// String.fromCharCode(...bytes) は引数が多すぎるとスタックを溢れさせるため、
// 小分けにして繋ぐ
const CHUNK = 8192

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.byteLength; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK))
  }
  return btoa(binary)
}

// base64url (WebAuthn の credential ID の形) をバイト列に戻す。
// `-` `_` を base64 の `+` `/` へ写し、削られた `=` を補う。
export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padding = (4 - (base64.length % 4)) % 4
  return base64ToBytes(base64 + '='.repeat(padding))
}

// 外から来る文字列を扱うので、base64 でなければ null を返す (投げない)。
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  let binary: string
  try {
    binary = atob(text)
  } catch {
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) {
    bytes[at] = binary.charCodeAt(at)
  }
  return bytes
}
