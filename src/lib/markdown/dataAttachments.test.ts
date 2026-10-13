import { describe, expect, test } from 'vitest'
import { attachmentIndexOf, dataNamesOf, missingNames } from './dataAttachments'

describe('dataNamesOf', () => {
  test('picks the file name after data: and ignores the legend', () => {
    expect(dataNamesOf('device: nanovna\ndata: 3-1.s2p 計算\n')).toEqual(['3-1.s2p'])
  })

  test('returns names in written order without duplicates', () => {
    expect(dataNamesOf('data: a.csv\ndata: b.csv\ndata: a.csv\n')).toEqual(['a.csv', 'b.csv'])
  })

  test('does not follow path-like names', () => {
    expect(dataNamesOf('data: ../secret.csv\ndata: dir/x.csv\n')).toEqual([])
  })

  test('only reads the top-level key', () => {
    expect(dataNamesOf('notes:\n  - data: x.csv\n')).toEqual([])
  })

  test('caps the number of files', () => {
    const source = Array.from({ length: 12 }, (_, i) => `data: f${i}.csv`).join('\n')

    expect(dataNamesOf(source)).toHaveLength(8)
  })
})

describe('attachmentIndexOf', () => {
  test('maps the original name in alt to the served url', () => {
    const md = '測定\n\n![3-1.s2p](/api/images/0a1b2c3d-0000-4000-8000-000000000000.s2p)\n'

    expect(attachmentIndexOf(md).get('3-1.s2p')).toBe(
      '/api/images/0a1b2c3d-0000-4000-8000-000000000000.s2p',
    )
  })

  test('ignores images and non-text attachments', () => {
    const md = '![図](/api/images/0a1b2c3d-0000-4000-8000-000000000000.png)'

    expect(attachmentIndexOf(md).size).toBe(0)
  })

  test('keeps the first one when a name appears twice', () => {
    const md =
      '![a.csv](/api/images/11111111-0000-4000-8000-000000000000.csv)\n' +
      '![a.csv](/api/images/22222222-0000-4000-8000-000000000000.csv)\n'

    expect(attachmentIndexOf(md).get('a.csv')).toContain('11111111')
  })
})

describe('missingNames', () => {
  test('lists the names with no attachment', () => {
    const index = new Map([['a.csv', '/api/images/x.csv']])

    expect(missingNames(['a.csv', 'b.csv'], index)).toEqual(['b.csv'])
  })
})

describe('loadDataFiles', () => {
  const index = new Map([
    ['a.csv', '/api/images/a.csv'],
    ['big.csv', '/api/images/big.csv'],
    ['bad.csv', '/api/images/bad.csv'],
  ])
  const fetchText = async (url: string): Promise<string> => {
    if (url.endsWith('bad.csv')) throw new Error('500')
    if (url.endsWith('big.csv')) return 'x'.repeat(1024 * 1024 + 1)
    return '1,2\n'
  }

  test('loads what it can and reports the rest', async () => {
    const { loadDataFiles } = await import('./dataAttachments')

    const loaded = await loadDataFiles(['a.csv', 'none.csv', 'big.csv', 'bad.csv'], index, fetchText)

    expect([...loaded.files.keys()]).toEqual(['a.csv'])
    expect(loaded.problems).toHaveLength(3)
    expect(loaded.problems[0]).toContain('none.csv')
  })
})
