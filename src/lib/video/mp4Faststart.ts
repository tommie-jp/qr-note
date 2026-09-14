// mp4 の moov を先頭へ移す (いわゆる faststart)。
// 41-QR-search/docs/12-添付ファイル種類拡張メモ.md「iPhone で録音が再生できなかった件」
//
// iOS Safari の MediaRecorder が出す mp4 は
//
//   ftyp | mdat (音声データ本体) | moov (再生に必要なメタデータ)
//
// の順で、**moov がファイル末尾**にある。録音中は長さが判らないので、
// 書き終えてから moov を付けるしかない — 録音側の都合としては正しい。
// だが <audio preload="metadata"> は先頭しか取りに行かないため、iOS Safari は
// 1 回目の再生に失敗し、2 回目もデータが揃わないまま途中で止まる。
//
// 直し方は昔から決まっていて、moov を mdat の前に移す。ただの並べ替えでは
// 済まない: stco / co64 が持つチャンク位置は**ファイル先頭からの絶対オフセット**
// なので、mdat がずれた分だけ全部足し直す必要がある。
//
// 扱うのは録音が出す単純な形だけ。少しでも想定と違えば null を返し、
// 呼び手は元のバイト列をそのまま使う (**壊すくらいなら直さない**)。

interface Box {
  type: string
  start: number // ボックス先頭 (サイズ欄) の位置
  headerSize: number // 中身までの距離 (8、64bit 長なら 16)
  size: number // ヘッダを含む全長
}

// チャンク位置表を探すためにたどる入れ子。moov > trak > mdia > minf > stbl と
// 決まった道だけ降りる (udta/meta の中まで覗かない — 位置表は無いため)
const CONTAINER_TYPES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])

// 並びを読む。壊れていれば null (throw しない)
function readBoxes(bytes: Uint8Array, from: number, to: number): Box[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder('latin1')
  const boxes: Box[] = []
  let at = from
  while (at + 8 <= to) {
    const declared = view.getUint32(at)
    const type = decoder.decode(bytes.subarray(at + 4, at + 8))
    let size = declared
    let headerSize = 8
    if (declared === 1) {
      if (at + 16 > to) {
        return null
      }
      size = Number(view.getBigUint64(at + 8))
      headerSize = 16
    } else if (declared === 0) {
      size = to - at
    }
    if (size < headerSize || at + size > to) {
      return null // 進めない / はみ出す長さは扱わない
    }
    boxes.push({ type, start: at, headerSize, size })
    at += size
  }
  return at === to ? boxes : null // 端数が余る並びも扱わない
}

// moov の中の stco / co64 をすべて訪ねる。見つけた位置表ごとに visit を呼ぶ。
// 破損していれば false (呼び手は諦める)
function eachChunkOffsetTable(
  moov: Uint8Array,
  visit: (table: Box, container: Uint8Array) => boolean,
): boolean {
  const walk = (bytes: Uint8Array, from: number, to: number): boolean => {
    const boxes = readBoxes(bytes, from, to)
    if (!boxes) {
      return false
    }
    for (const box of boxes) {
      if (box.type === 'stco' || box.type === 'co64') {
        if (!visit(box, bytes)) {
          return false
        }
      } else if (CONTAINER_TYPES.has(box.type)) {
        if (!walk(bytes, box.start + box.headerSize, box.start + box.size)) {
          return false
        }
      }
    }
    return true
  }
  return walk(moov, 0, moov.byteLength)
}

// 位置表の各要素に delta を足す。mdat より前を指す要素があれば、前提
// (すべて mdat の中を指す) が崩れているので false を返して丸ごと諦める
function shiftChunkOffsets(
  table: Box,
  bytes: Uint8Array,
  delta: number,
  mdatStart: number,
): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const body = table.start + table.headerSize
  // FullBox: version(1) + flags(3) → entry_count(4) → 要素の並び
  if (body + 8 > table.start + table.size) {
    return false
  }
  const count = view.getUint32(body + 4)
  const wide = table.type === 'co64'
  const entrySize = wide ? 8 : 4
  const first = body + 8
  if (first + count * entrySize > table.start + table.size) {
    return false
  }
  for (let i = 0; i < count; i++) {
    const at = first + i * entrySize
    const current = wide ? Number(view.getBigUint64(at)) : view.getUint32(at)
    if (current < mdatStart) {
      return false // mdat の外を指している。触らない
    }
    const next = current + delta
    if (wide) {
      view.setBigUint64(at, BigInt(next))
    } else {
      if (next > 0xffff_ffff) {
        return false // 32bit に収まらない (この上限では起きないが念のため)
      }
      view.setUint32(at, next)
    }
  }
  return true
}

// moov を mdat の前へ移した新しいバイト列を返す。
// 既に先頭にある / 想定外の形 / 書き換えられない場合は null。
// 戻り値を Uint8Array<ArrayBuffer> にするのは、そのまま Blob へ渡せるようにするため
// (SharedArrayBuffer 由来だと BlobPart として受け付けられない)
export function moveMoovToFront(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const boxes = readBoxes(bytes, 0, bytes.byteLength)
  if (!boxes) {
    return null
  }
  const moovIndex = boxes.findIndex((box) => box.type === 'moov')
  const mdatIndex = boxes.findIndex((box) => box.type === 'mdat')
  if (moovIndex < 0 || mdatIndex < 0) {
    return null
  }
  if (boxes.filter((box) => box.type === 'moov').length > 1) {
    return null // 複数 moov は扱わない
  }
  if (moovIndex < mdatIndex) {
    return null // 既に mdat より前。直す必要がない
  }
  // 断片化 mp4 (moof を持つ) は位置表の考え方が違うので触らない
  if (boxes.some((box) => box.type === 'moof')) {
    return null
  }

  const moovBox = boxes[moovIndex]
  const mdatBox = boxes[mdatIndex]

  // moov を写して、その写しの中の位置表を書き換える (元のバイト列は変えない)
  const moov = bytes.slice(moovBox.start, moovBox.start + moovBox.size)
  const ok = eachChunkOffsetTable(moov, (table, container) =>
    shiftChunkOffsets(table, container, moovBox.size, mdatBox.start),
  )
  if (!ok) {
    return null
  }

  // 並べ直す: mdat より前のもの → moov → 残り (元の moov は除く)
  const out = new Uint8Array(bytes.byteLength)
  let written = 0
  const copy = (from: number, to: number) => {
    out.set(bytes.subarray(from, to), written)
    written += to - from
  }
  copy(0, mdatBox.start) // ftyp など
  out.set(moov, written)
  written += moov.byteLength
  for (const box of boxes.slice(mdatIndex)) {
    if (box.type !== 'moov') {
      copy(box.start, box.start + box.size)
    }
  }
  return written === bytes.byteLength ? out : null
}
