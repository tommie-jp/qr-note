import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { parseTotalMips } from './benchmark'

describe('parseTotalMips', () => {
  it('returns the rating on the Tot line', () => {
    const out = ['Avr:      5916    99   6154   6111  |      64365    99   5634   5605', 'Tot:              99   5894   5858'].join('\n')
    expect(parseTotalMips(out)).toBe(5858)
  })

  it('throws when there is no Tot line', () => {
    expect(() => parseTotalMips('7z: command failed')).toThrow('Tot:')
  })
})

describe('readSavedBenchmark', () => {
  it('returns null when nothing has been saved', async () => {
    const { readSavedBenchmark } = await import('./benchmark')
    expect(await readSavedBenchmark('/nonexistent-dir/qr-benchmark.json')).toBeNull()
  })

  it('throws when the saved file has the wrong shape', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { readSavedBenchmark } = await import('./benchmark')
    const dir = await mkdtemp(join(tmpdir(), 'bench-'))
    await writeFile(join(dir, 'b.json'), '{"singleMips":1}')
    await expect(readSavedBenchmark(join(dir, 'b.json'))).rejects.toThrow('形が不正')
  })
})
