import { describe, expect, test } from 'vitest'
import { withCircuitEnvironment } from './circuitikz'

// ```circuitikz というフェンス名で種類は判っているので、`\begin{circuitikz}` を
// 毎回書かせない。ただし**既に書いてあるものは触らない** — 既存のノートは
// 全部この環境を含んでおり、無条件に包むと二重になって壊れる。

describe('withCircuitEnvironment', () => {
  test('環境が無ければ補う (本体だけ書けば描ける)', () => {
    expect(withCircuitEnvironment('\\draw (0,0) to[R=$R_1$] (2,0);')).toBe(
      '\\begin{circuitikz}\n\\draw (0,0) to[R=$R_1$] (2,0);\n\\end{circuitikz}',
    )
  })

  test('環境が書いてあれば触らない (二重に包まない)', () => {
    // 既存のノートはすべてこの形。ここが壊れると過去の図が全部描けなくなる
    const source = '\\begin{circuitikz}\n\\draw (0,0) -- (1,1);\n\\end{circuitikz}'
    expect(withCircuitEnvironment(source)).toBe(source)
  })

  test('オプション付きの環境も触らない', () => {
    const source = '\\begin{circuitikz}[scale=1.5]\n\\draw (0,0) -- (1,1);\n\\end{circuitikz}'
    expect(withCircuitEnvironment(source)).toBe(source)
  })

  test('tikzpicture で描いているものも触らない', () => {
    // 回路以外の図を circuitikz フェンスで描いているノートがあり得る
    const source = '\\begin{tikzpicture}\n\\draw (0,0) circle (1);\n\\end{tikzpicture}'
    expect(withCircuitEnvironment(source)).toBe(source)
  })

  test('入れ子の環境しか無いものは補う', () => {
    // `\begin{scope}` は図の外枠ではないので、外枠は別に要る
    const wrapped = withCircuitEnvironment('\\begin{scope}\n\\draw (0,0) -- (1,1);\n\\end{scope}')
    expect(wrapped.startsWith('\\begin{circuitikz}')).toBe(true)
    expect(wrapped.endsWith('\\end{circuitikz}')).toBe(true)
  })
})
