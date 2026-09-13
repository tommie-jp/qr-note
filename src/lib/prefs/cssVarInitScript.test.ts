import { describe, expect, test } from 'vitest'
import { makeCssVarInitScript } from './cssVarInitScript'

type Stored = Record<string, string>

interface Run {
  applied: [name: string, value: string][]
  threw: boolean
}

// localStorage / document を差し替えて、生成したスクリプトを実際に走らせる
// (node にはどちらも無いので、使う分だけの偽物を渡す)
function run(script: string, stored: Stored | 'throws'): Run {
  const applied: [string, string][] = []
  const localStorage = {
    getItem: (key: string) => {
      if (stored === 'throws') {
        throw new Error('blocked')
      }
      return stored[key] ?? null
    },
  }
  const document = {
    documentElement: {
      style: {
        setProperty: (name: string, value: string) => {
          applied.push([name, value])
        },
      },
    },
  }
  try {
    new Function('localStorage', 'document', script)(localStorage, document)
    return { applied, threw: false }
  } catch {
    return { applied, threw: true }
  }
}

describe('makeCssVarInitScript (clamp)', () => {
  const script = makeCssVarInitScript({
    normalize: 'clamp',
    targets: [
      { storageKey: 'w', cssVar: '--w', unit: 'rem', min: 9, max: 28 },
      { storageKey: 'h', cssVar: '--h', unit: 'dvh', min: 20, max: 80 },
    ],
  })

  test('保存された数を単位付きで CSS 変数へ写す', () => {
    // Arrange / Act
    const result = run(script, { w: '18', h: '60' })

    // Assert
    expect(result).toEqual({
      applied: [
        ['--w', '18rem'],
        ['--h', '60dvh'],
      ],
      threw: false,
    })
  })

  test('0.1 刻みに丸め、範囲外はいちばん近い端へ寄せる', () => {
    expect(run(script, { w: '16.34' }).applied).toEqual([['--w', '16.3rem']])
    expect(run(script, { w: '2' }).applied).toEqual([['--w', '9rem']])
    expect(run(script, { h: '999' }).applied).toEqual([['--h', '80dvh']])
  })

  test('保存が無い・数として読めない値は何も書かない (CSS の既定のまま)', () => {
    expect(run(script, {}).applied).toEqual([])
    expect(run(script, { w: 'ひろく', h: '' }).applied).toEqual([])
    // 読めない値があっても、他の変数は当てる
    expect(run(script, { w: 'ひろく', h: '50' }).applied).toEqual([['--h', '50dvh']])
  })

  test('localStorage が投げても外へ投げない', () => {
    expect(run(script, 'throws')).toEqual({ applied: [], threw: false })
  })
})

describe('makeCssVarInitScript (nearestStep)', () => {
  const script = makeCssVarInitScript({
    normalize: 'nearestStep',
    targets: [
      { storageKey: 's', cssVar: '--s', unit: '', steps: [0.5, 1, 2], skip: 1 },
    ],
  })

  test('いちばん近い段へ寄せて写す', () => {
    expect(run(script, { s: '2' }).applied).toEqual([['--s', '2']])
    expect(run(script, { s: '1.8' }).applied).toEqual([['--s', '2']])
    expect(run(script, { s: '0.1' }).applied).toEqual([['--s', '0.5']])
  })

  test('寄せた段が skip と同じなら書かない', () => {
    expect(run(script, { s: '1' }).applied).toEqual([])
    expect(run(script, { s: '1.2' }).applied).toEqual([])
  })

  test('保存が無い・読めない値は書かず、localStorage が投げても投げない', () => {
    expect(run(script, {}).applied).toEqual([])
    expect(run(script, { s: 'abc' }).applied).toEqual([])
    expect(run(script, 'throws')).toEqual({ applied: [], threw: false })
  })
})

describe('埋め込み', () => {
  test('値に `</script>` があってもインラインスクリプトを途中で閉じない', () => {
    // Arrange
    const script = makeCssVarInitScript({
      normalize: 'clamp',
      targets: [{ storageKey: '</script>', cssVar: '--x', unit: 'px', min: 0, max: 9 }],
    })

    // Act / Assert — 文字列としては同じ鍵を読む
    expect(script).not.toContain('</script>')
    expect(run(script, { '</script>': '3' }).applied).toEqual([['--x', '3px']])
  })
})
