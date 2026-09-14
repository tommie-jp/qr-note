import { expect, test } from 'vitest'
import { moveMoovToFront } from './mp4Faststart'

const enc = new TextEncoder()

function box(type: string, payload: Uint8Array): Uint8Array {
  const buf = new Uint8Array(8 + payload.byteLength)
  new DataView(buf.buffer).setUint32(0, buf.byteLength)
  buf.set(enc.encode(type), 4)
  buf.set(payload, 8)
  return buf
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

// stco: version+flags(4) → entry_count(4) → 32bit オフセットの並び
function stcoBox(offsets: number[]): Uint8Array {
  const payload = new Uint8Array(8 + offsets.length * 4)
  const view = new DataView(payload.buffer)
  view.setUint32(4, offsets.length)
  offsets.forEach((offset, i) => view.setUint32(8 + i * 4, offset))
  return box('stco', payload)
}

function co64Box(offsets: number[]): Uint8Array {
  const payload = new Uint8Array(8 + offsets.length * 8)
  const view = new DataView(payload.buffer)
  view.setUint32(4, offsets.length)
  offsets.forEach((offset, i) => view.setBigUint64(8 + i * 8, BigInt(offset)))
  return box('co64', payload)
}

function moovBox(table: Uint8Array): Uint8Array {
  return box('moov', box('trak', box('mdia', box('minf', box('stbl', table)))))
}

// 実機と同じ並び (ftyp → mdat → moov) を組む。mdat の中身は位置が判るよう
// 1 バイトずつ違う値にしておき、並べ替えた後も同じ中身を指しているか見る
function recordingLike(
  makeTable: (offsets: number[]) => Uint8Array,
  mdatPayloadSize = 64,
): { bytes: Uint8Array; chunkOffsets: number[]; moovSize: number } {
  const ftyp = box('ftyp', enc.encode('M4A isommp42'))
  const payload = new Uint8Array(mdatPayloadSize).map((_, i) => i % 251)
  const mdat = box('mdat', payload)
  const mdatDataStart = ftyp.byteLength + 8
  const chunkOffsets = [mdatDataStart, mdatDataStart + 16, mdatDataStart + 32]
  const moov = moovBox(makeTable(chunkOffsets))
  return {
    bytes: concat([ftyp, mdat, moov]),
    chunkOffsets,
    moovSize: moov.byteLength,
  }
}

function topLevelTypes(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder('latin1')
  const types: string[] = []
  let at = 0
  while (at + 8 <= bytes.byteLength) {
    const size = view.getUint32(at)
    types.push(decoder.decode(bytes.subarray(at + 4, at + 8)))
    at += size
  }
  return types
}

// stco の中身を読み出す (先頭の 1 つの表だけ見れば足りる)
function readStco(bytes: Uint8Array): number[] {
  const marker = enc.encode('stco')
  for (let at = 0; at + 4 <= bytes.byteLength; at++) {
    if (marker.every((byte, i) => bytes[at + i] === byte)) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const count = view.getUint32(at + 8)
      return Array.from({ length: count }, (_, i) => view.getUint32(at + 12 + i * 4))
    }
  }
  return []
}

test('moov を mdat の前へ移す (iOS Safari の録音と同じ並び)', () => {
  const { bytes, moovSize } = recordingLike(stcoBox)
  expect(topLevelTypes(bytes)).toEqual(['ftyp', 'mdat', 'moov'])

  const moved = moveMoovToFront(bytes)
  expect(moved).not.toBeNull()
  expect(topLevelTypes(moved!)).toEqual(['ftyp', 'moov', 'mdat'])
  // 長さは変わらない (中身の詰め替えだけ)
  expect(moved!.byteLength).toBe(bytes.byteLength)
  expect(moovSize).toBeGreaterThan(0)
})

// これが本命の不変条件。並べ替えても、位置表は**同じ音声データ**を指し続ける
test('並べ替え後も位置表が同じ中身を指す', () => {
  const { bytes, chunkOffsets } = recordingLike(stcoBox)
  const moved = moveMoovToFront(bytes)!
  const movedOffsets = readStco(moved)

  expect(movedOffsets).toHaveLength(chunkOffsets.length)
  chunkOffsets.forEach((before, i) => {
    const after = movedOffsets[i]
    expect(after).not.toBe(before) // ずれている
    // ずれた先には元と同じ 16 バイトがある
    expect(Array.from(moved.subarray(after, after + 16))).toEqual(
      Array.from(bytes.subarray(before, before + 16)),
    )
  })
})

test('64bit の位置表 (co64) も書き換える', () => {
  const { bytes, chunkOffsets, moovSize } = recordingLike(co64Box)
  const moved = moveMoovToFront(bytes)!
  const view = new DataView(moved.buffer)
  const marker = enc.encode('co64')
  let found = -1
  for (let at = 0; at + 4 <= moved.byteLength; at++) {
    if (marker.every((byte, i) => moved[at + i] === byte)) {
      found = at
      break
    }
  }
  expect(found).toBeGreaterThan(0)
  const first = Number(view.getBigUint64(found + 12))
  expect(first).toBe(chunkOffsets[0] + moovSize)
})

test('既に moov が前にあるものは触らない', () => {
  const { bytes } = recordingLike(stcoBox)
  const moved = moveMoovToFront(bytes)!
  // 一度直したものをもう一度かけても、直すところが無いので null
  expect(moveMoovToFront(moved)).toBeNull()
})

test('想定と違う形は書き換えず null を返す (壊すくらいなら直さない)', () => {
  // moov が無い
  expect(moveMoovToFront(concat([box('ftyp', enc.encode('M4A ')), box('mdat', new Uint8Array(8))]))).toBeNull()
  // mdat が無い
  expect(moveMoovToFront(concat([box('ftyp', enc.encode('M4A ')), moovBox(stcoBox([0]))]))).toBeNull()
  // 断片化 mp4 (moof を持つ) は位置表の考え方が違う
  const fragmented = concat([
    box('ftyp', enc.encode('iso5')),
    box('moof', new Uint8Array(8)),
    box('mdat', new Uint8Array(16)),
    moovBox(stcoBox([40])),
  ])
  expect(moveMoovToFront(fragmented)).toBeNull()
  // 空・短すぎる
  expect(moveMoovToFront(new Uint8Array(0))).toBeNull()
  expect(moveMoovToFront(enc.encode('not an mp4'))).toBeNull()
})

test('mdat の外を指す位置表があれば諦める', () => {
  const ftyp = box('ftyp', enc.encode('M4A '))
  const mdat = box('mdat', new Uint8Array(64))
  // ftyp の中 (mdat より前) を指している = 前提が崩れている
  const moov = moovBox(stcoBox([4]))
  expect(moveMoovToFront(concat([ftyp, mdat, moov]))).toBeNull()
})

test('長さが食い違う壊れた並びは扱わない', () => {
  const broken = new Uint8Array(16)
  new DataView(broken.buffer).setUint32(0, 999) // 実際より長い宣言
  broken.set(enc.encode('mdat'), 4)
  expect(moveMoovToFront(broken)).toBeNull()
})
