// バイト署名の照合に使う小道具 (docs/93-リファクタリング計画.md §4-2)。
// sniff/ の各判定 (画像・音声・動画・PDF) と箱の読み取りが共有する。

export function startsWith(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((byte, i) => bytes[i] === byte)
}

// 署名やボックス型の照合はバイトのまま行う。比較のたびに文字列へ起こさないため、
// 決め打ちの ASCII は最初に一度だけバイト列にしておく
export const encodeAscii = (text: string) => new TextEncoder().encode(text)

// マーカーの 1 バイト目を引くための表 (256 要素)。走査ループで
// 「ここから照合する価値があるか」を配列 1 回の添字引きで判定するために使う。
export function leadByteTable(markers: readonly Uint8Array[]): Uint8Array {
  const table = new Uint8Array(256)
  for (const marker of markers) {
    table[marker[0]] = 1
  }
  return table
}

export function matchesAt(
  bytes: Uint8Array,
  at: number,
  marker: Uint8Array,
  limit: number,
): boolean {
  if (at + marker.byteLength > limit) {
    return false
  }
  for (let i = 0; i < marker.byteLength; i++) {
    if (bytes[at + i] !== marker[i]) {
      return false
    }
  }
  return true
}

// ASCII マーカーのいずれかが bytes[0, end) にあるか。
// **文字列へ起こさない** — 10MB を latin1 文字列にすると倍のメモリを食うため、
// バイトのまま見る。1 バイト目で絞ってから照合するので 10MB でも実用的に速い。
export function containsMarker(
  bytes: Uint8Array,
  markers: readonly Uint8Array[],
  leads: Uint8Array,
  end: number,
): boolean {
  const limit = Math.min(end, bytes.byteLength)
  for (let at = 0; at < limit; at++) {
    if (leads[bytes[at]] === 0) {
      continue
    }
    for (const marker of markers) {
      if (matchesAt(bytes, at, marker, limit)) {
        return true
      }
    }
  }
  return false
}
