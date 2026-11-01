// 区画を残す側の配列 (parts) に、元のバイト列の切れ端を積む小道具
// (2026-11 の監査 M-9)。
//
// 残す区画を 1 つずつ subarray で積むと、要素数が入力の区画数に比例する。
// JPEG なら `FF 01` (TEM、長さなし) を敷き詰めた 2MB で +120MB、10MB で +518MB
// になった (デモの上限 2MB でも届く)。**直前の切れ端と連続しているなら伸ばす**
// だけで、要素数は「捨てた区画の数 + 1」に収まる。
//
// 伸ばせるのは同じ元 (buffer) の連続した範囲のとき。差し替えた区画 (最小 EXIF
// など別の buffer) はそのまま積む

export function pushSlice(parts: Uint8Array[], input: Uint8Array, start: number, end: number): void {
  const last = parts[parts.length - 1]
  if (
    last !== undefined &&
    last.buffer === input.buffer &&
    last.byteOffset + last.byteLength === input.byteOffset + start
  ) {
    parts[parts.length - 1] = input.subarray(
      last.byteOffset - input.byteOffset,
      end,
    )
    return
  }
  parts.push(input.subarray(start, end))
}
