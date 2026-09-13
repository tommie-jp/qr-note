import { expect, test } from 'vitest'
import { normalizeTextBytes } from './normalizeText'

const utf8 = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

// UTF-16 の生成は手打ちだと桁を取り違えるので、コードポイントから組み立てる。
// BOM を先頭に付ける (little / big の別で並びを変える)。BMP 内の文字だけ扱う
function utf16(text: string, endian: 'le' | 'be'): Uint8Array {
  const units = [0xfeff, ...text].map((c) =>
    typeof c === 'number' ? c : c.codePointAt(0)!,
  )
  const bytes = new Uint8Array(units.length * 2)
  units.forEach((u, i) => {
    const hi = (u >> 8) & 0xff
    const lo = u & 0xff
    bytes[i * 2] = endian === 'le' ? lo : hi
    bytes[i * 2 + 1] = endian === 'le' ? hi : lo
  })
  return bytes
}

test('UTF-8 のテキストはそのまま受け付ける', () => {
  const result = normalizeTextBytes(utf8('日本語の memo\nsecond line\n'))
  expect(result).not.toBeNull()
  expect(decode(result!)).toBe('日本語の memo\nsecond line\n')
})

test('タブ・CRLF を含むテキストも受け付ける (CSV の実物がこの形)', () => {
  const result = normalizeTextBytes(utf8('a\tb\r\nc\td\r\n'))
  expect(result).not.toBeNull()
  expect(decode(result!)).toBe('a\tb\r\nc\td\r\n')
})

// Windows で書き出した日本語 CSV は今も Shift_JIS が多い。ここで UTF-8 へ
// 直しておけば、配信は常に charset=utf-8 の 1 通りで済む (HEIC→WebP と同じ流儀)
test('Shift_JIS のテキストは UTF-8 に変換して受け付ける', () => {
  // "日本語" (CP932): 93 fa 96 7b 8c ea
  const sjis = Uint8Array.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x0a])
  const result = normalizeTextBytes(sjis)
  expect(result).not.toBeNull()
  expect(decode(result!)).toBe('日本語\n')
})

test('BOM は落としてから保存する', () => {
  const withBom = utf8('﻿id,name\n1,x\n')
  const result = normalizeTextBytes(withBom)
  expect(decode(result!)).toBe('id,name\n1,x\n')
})

// Excel や一部ツール (iOS 上のアプリ含む) が日本語 CSV を UTF-16 で書き出す
// ことがある。BOM があれば曖昧さなく判別できるので、UTF-8 へ直して受け付ける
test('UTF-16LE (BOM 付き) のテキストは UTF-8 に変換して受け付ける', () => {
  const result = normalizeTextBytes(utf16('id,名前\n', 'le'))
  expect(result).not.toBeNull()
  expect(decode(result!)).toBe('id,名前\n')
})

test('UTF-16BE (BOM 付き) のテキストも受け付ける', () => {
  const result = normalizeTextBytes(utf16('id,名前\n', 'be'))
  expect(result).not.toBeNull()
  expect(decode(result!)).toBe('id,名前\n')
})

// BOM 無しの UTF-16 は受けない。UTF-16 はほぼ何でもデコードできてしまい、
// binary をテキストとして取り込みかねないため (BOM が判別の唯一の手掛かり)
test('BOM 無しの UTF-16 相当は受けない (binary 誤検出を避ける)', () => {
  // BOM を外した "AB" (UTF-16LE)。00 が混じるので NUL 拒否で落ちる
  expect(normalizeTextBytes(Uint8Array.from([0x41, 0x00, 0x42, 0x00]))).toBeNull()
})

// ここがテキスト判定の要。テキストには署名が無いので、
// 「バイナリでないこと」を積極的に確かめないと何でも通ってしまう
test('NUL を含むバイト列は拒否する', () => {
  expect(normalizeTextBytes(Uint8Array.from([0x61, 0x00, 0x62]))).toBeNull()
})

test('制御文字を含むバイト列は拒否する (拡張子を偽装した実行ファイル対策)', () => {
  // ELF ヘッダ: 7f 45 4c 46 …
  const elf = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00])
  expect(normalizeTextBytes(elf)).toBeNull()
  // ZIP (docx/xlsx もこれ): "PK\x03\x04"
  const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
  expect(normalizeTextBytes(zip)).toBeNull()
})

// C1 制御文字 (80-9F) は UTF-8 では 2 バイト列として「正しく」デコードされる。
// 判定をデコード後の文字で行っているので、C0 だけ見ていると素通りしてしまう
test('DEL・C1 制御文字を含むテキストも拒否する', () => {
  expect(normalizeTextBytes(utf8('a\u007fb'))).toBeNull()
  expect(normalizeTextBytes(utf8('a\u0085b'))).toBeNull()
})

test('UTF-8 としても Shift_JIS としても解釈できないバイト列は拒否する', () => {
  // 0xfd-0xff は CP932 でも UTF-8 でも現れない
  expect(normalizeTextBytes(Uint8Array.from([0xfd, 0xfe, 0xff, 0x41]))).toBeNull()
})

test('空ファイルは拒否する (中身が無いので添付する意味がない)', () => {
  expect(normalizeTextBytes(new Uint8Array(0))).toBeNull()
})

// SVG・HTML は「テキストとしては妥当」なので、**この関数は通す**。
// 中身だけでは区別できないため、止めるのは名前側の関門
// (uploads/sniff/text.ts の textSaveInfo が txt/csv/md 以外を受けない)。
// 判定を 2 つに分けているので、どちらの意図もそれぞれの場所で読める
test('HTML や SVG も中身としてはテキスト (名前の関門で弾く担当ではない)', () => {
  const svg = utf8('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
  expect(normalizeTextBytes(svg)).not.toBeNull()
})
