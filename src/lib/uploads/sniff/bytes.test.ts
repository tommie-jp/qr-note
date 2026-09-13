import { describe, expect, test } from 'vitest'
import { containsMarker, encodeAscii, leadByteTable, matchesAt, startsWith } from './bytes'

describe('startsWith', () => {
  test('先頭が期待のバイト列と一致するときだけ true', () => {
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46])

    expect(startsWith(bytes, [0x25, 0x50])).toBe(true)
    expect(startsWith(bytes, [0x50])).toBe(false)
  })

  test('入力が期待より短ければ false (範囲外を一致とみなさない)', () => {
    expect(startsWith(Uint8Array.from([0x25]), [0x25, 0x50])).toBe(false)
    expect(startsWith(new Uint8Array(0), [0x00])).toBe(false)
  })
})

describe('matchesAt', () => {
  test('指定位置からマーカーが並んでいれば true', () => {
    const bytes = encodeAscii('xxhdlryy')

    expect(matchesAt(bytes, 2, encodeAscii('hdlr'), bytes.byteLength)).toBe(true)
    expect(matchesAt(bytes, 1, encodeAscii('hdlr'), bytes.byteLength)).toBe(false)
  })

  test('limit をはみ出す照合は false', () => {
    const bytes = encodeAscii('xxhdlr')

    expect(matchesAt(bytes, 2, encodeAscii('hdlr'), 5)).toBe(false)
  })
})

describe('containsMarker', () => {
  const markers = ['A_OPUS', 'A_VORBIS'].map(encodeAscii)
  const leads = leadByteTable(markers)

  test('マーカーのいずれかが範囲内にあれば true', () => {
    const bytes = encodeAscii('....A_VORBIS..')

    expect(containsMarker(bytes, markers, leads, bytes.byteLength)).toBe(true)
  })

  test('範囲 (end) の外にしか無いマーカーは数えない', () => {
    const bytes = encodeAscii('....A_OPUS')

    expect(containsMarker(bytes, markers, leads, 6)).toBe(false)
    expect(containsMarker(bytes, markers, leads, 10)).toBe(true)
  })

  test('1 バイト目だけ合う位置では true にしない', () => {
    const bytes = encodeAscii('AAAA_OPU')

    expect(containsMarker(bytes, markers, leads, bytes.byteLength)).toBe(false)
  })
})

test('leadByteTable はマーカーの 1 バイト目にだけ印を付ける', () => {
  const table = leadByteTable([encodeAscii('V_VP9'), encodeAscii('A_OPUS')])

  expect(table.byteLength).toBe(256)
  expect(table['V'.charCodeAt(0)]).toBe(1)
  expect(table['A'.charCodeAt(0)]).toBe(1)
  expect(table.reduce((sum, v) => sum + v, 0)).toBe(2)
})
