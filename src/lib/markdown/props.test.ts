import { describe, expect, test } from 'vitest'
import {
  buildPropsTable,
  extractProps,
  parsePropNumber,
  parsePropToken,
  parseStoredProps,
  sortTableRows,
  type PropsTableRow,
} from './props'

describe('parsePropToken', () => {
  test('parses a plain key=value token', () => {
    expect(parsePropToken('hFE=208')).toEqual({
      key: 'hfe',
      label: 'hFE',
      value: '208',
    })
  })

  test('keeps the unit suffix in the value', () => {
    expect(parsePropToken('Vf=700mV')).toEqual({
      key: 'vf',
      label: 'Vf',
      value: '700mV',
    })
  })

  test('accepts a decimal value', () => {
    expect(parsePropToken('Vf=0.7V')?.value).toBe('0.7V')
    expect(parsePropToken('f=.5')?.value).toBe('.5')
  })

  test('accepts a signed value', () => {
    expect(parsePropToken('temp=-40')?.value).toBe('-40')
    expect(parsePropToken('offset=+5mV')?.value).toBe('+5mV')
  })

  test('accepts a percent unit', () => {
    expect(parsePropToken('tol=5%')?.value).toBe('5%')
  })

  test('accepts a multibyte unit', () => {
    expect(parsePropToken('R=10Ω')?.value).toBe('10Ω')
  })

  // 実メモにある書き方 (device=2N5551 / hFE=120～200)。値を「数値+単位」に狭めると
  // これらが落ち、しかも同じ行の他のプロパティごと黙って消える。
  test('accepts a non-numeric value such as a part number or package', () => {
    expect(parsePropToken('device=2SC1815')?.value).toBe('2SC1815')
    expect(parsePropToken('device=BC547')?.value).toBe('BC547')
    expect(parsePropToken('pkg=TO-92')?.value).toBe('TO-92')
  })

  test('accepts a range value', () => {
    expect(parsePropToken('hFE=120～200')?.value).toBe('120～200')
  })

  test('drops a trailing comma left over from prose separators', () => {
    expect(parsePropToken('hFE=440,')?.value).toBe('440')
    expect(parsePropToken('hFE=440、')?.value).toBe('440')
  })

  test('rejects a token whose value is only punctuation', () => {
    expect(parsePropToken('hFE=,')).toBeNull()
  })

  test('accepts hyphen and underscore in the key', () => {
    expect(parsePropToken('v_ce-max=50V')?.key).toBe('v_ce-max')
  })

  test('normalizes the key with NFKC + lowercase but keeps the label spelling', () => {
    expect(parsePropToken('ｈFE＝２０８')).toEqual({
      key: 'hfe',
      label: 'ｈFE',
      value: '２０８',
    })
  })

  test('rejects a token with no separator', () => {
    expect(parsePropToken('#BJT')).toBeNull()
    expect(parsePropToken('2SC1815')).toBeNull()
  })

  test('rejects an empty key or value', () => {
    expect(parsePropToken('hFE=')).toBeNull()
    expect(parsePropToken('=208')).toBeNull()
    expect(parsePropToken('=')).toBeNull()
  })

  test('rejects a key that does not start with a letter', () => {
    expect(parsePropToken('2sc=1')).toBeNull()
    expect(parsePropToken('_x=1')).toBeNull()
  })

  test('rejects a value containing another separator', () => {
    expect(parsePropToken('a=b=c')).toBeNull()
    expect(parsePropToken('Ｖｉ=２Ｖｒｍｓ、Ｒ＝５ｋΩ')).toBeNull()
  })

  // 誤爆を防いでいるのは「キーは英字始まり」と行全体条件で、値の狭さではない。
  test('rejects a URL-like token (the key is not a bare word)', () => {
    expect(parsePropToken('https://example.com/?a=1')).toBeNull()
    expect(parsePropToken('|x=1|')).toBeNull()
  })
})

describe('extractProps', () => {
  test('extracts a property line', () => {
    expect(extractProps('hFE=208 Vf=700mV')).toEqual([
      { key: 'hfe', label: 'hFE', value: '208' },
      { key: 'vf', label: 'Vf', value: '700mV' },
    ])
  })

  test('extracts a property line that follows a tag line', () => {
    const memo = '#BJT #2sc2712-y\nhFE=208 Vf=700mV'
    expect(extractProps(memo)).toEqual([
      { key: 'hfe', label: 'hFE', value: '208' },
      { key: 'vf', label: 'Vf', value: '700mV' },
    ])
  })

  test('accepts a property line anywhere in the memo', () => {
    const memo = 'タイトル\n\n本文です。\n\nhFE=208\n\nさらに本文'
    expect(extractProps(memo)).toEqual([{ key: 'hfe', label: 'hFE', value: '208' }])
  })

  test('merges multiple property lines in first-seen order', () => {
    expect(extractProps('hFE=208\n本文\nVf=700mV')).toEqual([
      { key: 'hfe', label: 'hFE', value: '208' },
      { key: 'vf', label: 'Vf', value: '700mV' },
    ])
  })

  test('keeps the first occurrence when a key repeats', () => {
    expect(extractProps('Vf=700mV Vf=650mV')).toEqual([
      { key: 'vf', label: 'Vf', value: '700mV' },
    ])
    expect(extractProps('Vf=700mV\nvf=650mV')).toEqual([
      { key: 'vf', label: 'Vf', value: '700mV' },
    ])
  })

  test('ignores a line that mixes prose with key=value', () => {
    expect(extractProps('実測では hFE=195 だった')).toEqual([])
  })

  test('ignores a tag-only line', () => {
    expect(extractProps('#BJT #2sc2712-y')).toEqual([])
  })

  test('ignores a list or table line', () => {
    expect(extractProps('- hFE=208')).toEqual([])
    expect(extractProps('| hFE=208 |')).toEqual([])
  })

  test('splits on full-width spaces', () => {
    expect(extractProps('hFE=208　Vf=700mV')).toEqual([
      { key: 'hfe', label: 'hFE', value: '208' },
      { key: 'vf', label: 'Vf', value: '700mV' },
    ])
  })

  test('ignores key = value with spaces around the separator', () => {
    expect(extractProps('hFE = 208')).toEqual([])
  })

  test('ignores properties inside a fenced code block', () => {
    const memo = '```text\nhFE=999\n```\n\nhFE=208'
    expect(extractProps(memo)).toEqual([{ key: 'hfe', label: 'hFE', value: '208' }])
  })

  test('ignores a line whose properties are inside inline code', () => {
    expect(extractProps('`hFE=999`')).toEqual([])
  })

  test('ignores a line where inline code sits beside a property', () => {
    expect(extractProps('hFE=208 `注`')).toEqual([])
  })

  test('ignores properties inside inline math', () => {
    expect(extractProps('$E=mc^2$')).toEqual([])
  })

  // コード/数式を潰した痕跡が値として残ってはいけない (表に ￼ が並んでしまう)。
  test('ignores a line whose value is written in inline code or math', () => {
    expect(extractProps('hFE=`208`')).toEqual([])
    expect(extractProps('hFE=$208$')).toEqual([])
  })

  test('ignores properties inside block math', () => {
    const memo = '$$\nx=1\n$$\n\nhFE=208'
    expect(extractProps(memo)).toEqual([{ key: 'hfe', label: 'hFE', value: '208' }])
  })

  test('ignores a bare URL line', () => {
    expect(extractProps('https://example.com/?a=1')).toEqual([])
  })

  test('handles CRLF line endings', () => {
    expect(extractProps('#BJT\r\nhFE=208')).toEqual([
      { key: 'hfe', label: 'hFE', value: '208' },
    ])
  })

  test('returns an empty array for a memo with no property line', () => {
    expect(extractProps('')).toEqual([])
    expect(extractProps('ただの本文です')).toEqual([])
  })
})

describe('parsePropNumber', () => {
  test('reads the numeric part of a value', () => {
    expect(parsePropNumber('208')).toBe(208)
    expect(parsePropNumber('700mV')).toBe(700)
    expect(parsePropNumber('0.7V')).toBe(0.7)
    expect(parsePropNumber('-40')).toBe(-40)
    expect(parsePropNumber('5%')).toBe(5)
  })

  test('reads full-width digits via NFKC', () => {
    expect(parsePropNumber('２０８')).toBe(208)
  })

  test('returns NaN when there is no numeric part', () => {
    expect(parsePropNumber('')).toBeNaN()
    expect(parsePropNumber('abc')).toBeNaN()
  })
})

describe('parseStoredProps', () => {
  test('passes through a well-formed array', () => {
    const stored = [{ key: 'hfe', label: 'hFE', value: '208' }]
    expect(parseStoredProps(stored)).toEqual(stored)
  })

  test('returns an empty array for null or a non-array', () => {
    expect(parseStoredProps(null)).toEqual([])
    expect(parseStoredProps(undefined)).toEqual([])
    expect(parseStoredProps('hFE=208')).toEqual([])
    expect(parseStoredProps({ key: 'hfe' })).toEqual([])
  })

  test('drops malformed entries', () => {
    const stored = [
      { key: 'hfe', label: 'hFE', value: '208' },
      { key: 'vf', label: 'Vf' },
      null,
      { key: 1, label: 'x', value: '2' },
    ]
    expect(parseStoredProps(stored)).toEqual([
      { key: 'hfe', label: 'hFE', value: '208' },
    ])
  })
})

describe('buildPropsTable', () => {
  const rows = [
    {
      itemNo: '1',
      summary: '2SC1815',
      props: [
        { key: 'hfe', label: 'hFE', value: '400' },
        { key: 'vf', label: 'Vf', value: '650mV' },
      ],
    },
    {
      itemNo: '2',
      summary: '2SC2712-Y',
      props: [
        { key: 'hfe', label: 'hFE', value: '208' },
        { key: 'vce', label: 'Vce', value: '50V' },
      ],
    },
  ]

  test('builds columns as the union of keys in first-seen order', () => {
    expect(buildPropsTable(rows).columns).toEqual([
      { key: 'hfe', label: 'hFE' },
      { key: 'vf', label: 'Vf' },
      { key: 'vce', label: 'Vce' },
    ])
  })

  test('keeps the first-seen label spelling for a column', () => {
    const table = buildPropsTable([
      { itemNo: '1', summary: 'a', props: [{ key: 'hfe', label: 'hFE', value: '1' }] },
      { itemNo: '2', summary: 'b', props: [{ key: 'hfe', label: 'HFE', value: '2' }] },
    ])
    expect(table.columns).toEqual([{ key: 'hfe', label: 'hFE' }])
  })

  test('builds one row per item with cells keyed by property key', () => {
    expect(buildPropsTable(rows).rows).toEqual([
      { itemNo: '1', summary: '2SC1815', cells: { hfe: '400', vf: '650mV' } },
      { itemNo: '2', summary: '2SC2712-Y', cells: { hfe: '208', vce: '50V' } },
    ])
  })

  test('drops items that have no properties', () => {
    const table = buildPropsTable([
      { itemNo: '1', summary: 'a', props: [{ key: 'hfe', label: 'hFE', value: '1' }] },
      { itemNo: '2', summary: 'b', props: [] },
    ])
    expect(table.rows.map((r) => r.itemNo)).toEqual(['1'])
  })

  test('returns empty columns and rows for no input', () => {
    expect(buildPropsTable([])).toEqual({ columns: [], rows: [] })
  })
})

describe('sortTableRows', () => {
  const rows: PropsTableRow[] = [
    { itemNo: '1', summary: 'a', cells: { hfe: '400' } },
    { itemNo: '2', summary: 'b', cells: { hfe: '208' } },
    { itemNo: '3', summary: 'c', cells: {} },
  ]

  test('returns the original order when no sort key is given', () => {
    expect(sortTableRows(rows, null, 'asc').map((r) => r.itemNo)).toEqual(['1', '2', '3'])
  })

  test('sorts by the numeric part ascending', () => {
    expect(sortTableRows(rows, 'hfe', 'asc').map((r) => r.itemNo)).toEqual(['2', '1', '3'])
  })

  test('sorts by the numeric part descending', () => {
    expect(sortTableRows(rows, 'hfe', 'desc').map((r) => r.itemNo)).toEqual(['1', '2', '3'])
  })

  test('keeps rows without the column at the end in both directions', () => {
    expect(sortTableRows(rows, 'hfe', 'asc').at(-1)?.itemNo).toBe('3')
    expect(sortTableRows(rows, 'hfe', 'desc').at(-1)?.itemNo).toBe('3')
  })

  test('sorts text values by name when there is no numeric part', () => {
    const textRows: PropsTableRow[] = [
      { itemNo: '1', summary: 'a', cells: { pkg: 'TO-92' } },
      { itemNo: '2', summary: 'b', cells: { pkg: 'SOT-23' } },
    ]
    expect(sortTableRows(textRows, 'pkg', 'asc').map((r) => r.itemNo)).toEqual(['2', '1'])
  })

  // device=2SC1815 と device=2N2222 はどちらも数値部が 2 で並ばないため、
  // 数値が同値のときは文字列で比べる。
  test('falls back to a name compare when the numeric parts tie', () => {
    const deviceRows: PropsTableRow[] = [
      { itemNo: '1', summary: 'a', cells: { device: '2SC1815' } },
      { itemNo: '2', summary: 'b', cells: { device: '2N2222' } },
    ]
    expect(sortTableRows(deviceRows, 'device', 'asc').map((r) => r.itemNo)).toEqual(['2', '1'])
  })

  test('keeps identical values in their original relative order', () => {
    const tied: PropsTableRow[] = [
      { itemNo: '1', summary: 'a', cells: { hfe: '208' } },
      { itemNo: '2', summary: 'b', cells: { hfe: '208' } },
    ]
    expect(sortTableRows(tied, 'hfe', 'asc').map((r) => r.itemNo)).toEqual(['1', '2'])
  })

  test('does not mutate the input array', () => {
    const input = [...rows]
    sortTableRows(input, 'hfe', 'asc')
    expect(input.map((r) => r.itemNo)).toEqual(['1', '2', '3'])
  })
})
