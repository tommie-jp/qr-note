import { expect, test } from 'vitest'
import { svgDataUri } from './svgDataUri'

const PREFIX = 'data:image/svg+xml;charset=utf-8,'

test('先頭に SVG の data URL の型を付ける', () => {
  expect(svgDataUri('<svg/>').startsWith(PREFIX)).toBe(true)
})

test('URL の区切りになる # と % を逃がす', () => {
  const uri = svgDataUri('<svg><path fill="#000" d="M0 0"/><text>50%</text></svg>')
  expect(uri).not.toMatch(/#|%(?![0-9A-F]{2})/)
})

test('属性の引用符と山括弧を逃がし、src 属性の中でも崩れない', () => {
  const body = svgDataUri('<svg a="b"/>').slice(PREFIX.length)
  expect(body).toBe('%3Csvg a=%22b%22/%3E')
})

test('改行とタブを逃がす (URL の解析で黙って捨てられるため)', () => {
  const body = svgDataUri('<svg>\n\t<text>a\r\nb</text></svg>').slice(PREFIX.length)
  expect(body).not.toMatch(/[\r\n\t]/)
})

test('元の SVG に戻せる (日本語の素子名も)', () => {
  const svg = `<svg font-family="'Noto Sans JP'"><text x="1">抵抗 10kΩ #1 50%</text>\n</svg>`
  expect(decodeURIComponent(svgDataUri(svg).slice(PREFIX.length))).toBe(svg)
})
