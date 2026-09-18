// 写真の撮影情報 (EXIF など) を抜く処理が共有する型と小道具
// (docs/97-写真の撮影情報削除計画.md)。
//
// 形式ごとの抜き方 (jpeg.ts / png.ts / webp.ts / gif.ts / avif.ts) は
// どれも「区画の並びを読み、要らない区画を落として繋ぎ直す」同じ形をしている。
// 画素のバイト列には触らない (§2-3)。

// 抜いた情報の種類。バックフィルの件数表示 (scripts/backfillPhotoMeta.ts) と
// テストが使う。保存経路は「変わったか」しか見ない
export type MetaKind =
  | 'exif' // 向き以外の EXIF (ソフト名・露出などを含む)
  | 'gps' // 撮影場所
  | 'datetime' // 撮影日時
  | 'camera' // 機種 (Make / Model)
  | 'xmp'
  | 'iptc'
  | 'comment'
  | 'trailer' // 画像の終端より後ろに付け足されたデータ (Motion Photo の動画など)
  | 'other' // 上のどれでもない付帯情報 (MPF の副画像・JFIF のサムネ・tIME など)

export interface StripOutcome {
  // 抜いた後のバイト列。何も抜かなかったときは入力と同じ中身
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly removed: ReadonlySet<MetaKind>
}

// 区画の並びが読めない (壊れている・想定外の形)。呼ぶ側 (index.ts) はこれを
// 受けたら sharp で作り直す。**黙って素通しはしない** (§2-3 fail-closed)
export class PhotoMetaFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoMetaFormatError'
  }
}

// 部分列を 1 本の新しいバイト列へ繋ぐ。入力の ArrayBuffer は共有しない
// (Prisma の Bytes は ArrayBuffer 実体の Uint8Array だけを受ける)
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

// 抜いた結果を返す。**中身が変わらなければ入力をそのまま返す** — 呼ぶ側
// (バックフィル) が「書き換えるか」をバイト比較だけで決められるように、
// また 2 回掛けても同じになる (冪等) ことを保つため
export function outcome(
  input: Uint8Array<ArrayBuffer>,
  parts: readonly Uint8Array[],
  removed: ReadonlySet<MetaKind>,
): StripOutcome {
  const bytes = concatBytes(parts)
  return bytesEqual(bytes, input)
    ? { bytes: input, removed: new Set() }
    : { bytes, removed }
}

// 先頭が ASCII の署名と一致するか (区画の識別子を見る)
export function hasAsciiPrefix(bytes: Uint8Array, prefix: string, at = 0): boolean {
  if (at + prefix.length > bytes.byteLength) {
    return false
  }
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[at + i] !== prefix.charCodeAt(i)) {
      return false
    }
  }
  return true
}
