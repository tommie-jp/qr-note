import { expect, test } from 'vitest'

import { offlineCircuitMap } from './circuits'
import { CIRCUITIKZ_LANG, CIRCUIT_LANG, circuitKey } from '@/lib/fenceLanguages'

// MarkdownView が引く鍵は**言語 + フェンスの中身 (trim 済み)**。
// ここがずれると図を引けず、圏外でだけコードブロックのまま出る
test('言語とフェンスの中身を鍵にしたマップを作る', () => {
  // Arrange
  const source = '\\draw (0,0) to[R] (2,0);'

  // Act
  const map = offlineCircuitMap([
    { source, lang: CIRCUITIKZ_LANG, svg: '<svg id="a"></svg>' },
  ])

  // Assert
  expect(map.get(circuitKey(CIRCUITIKZ_LANG, source))).toEqual({
    svg: '<svg id="a"></svg>',
  })
})

// 同じ本文が 2 つの言語で書かれていても、それぞれの場所に出る (docs/91)
test('言語が違えば別の図として引ける', () => {
  const source = 'A'

  const map = offlineCircuitMap([
    { source, lang: CIRCUITIKZ_LANG, svg: '<svg id="tikz"></svg>' },
    { source, lang: CIRCUIT_LANG, svg: '<svg id="yaml"></svg>' },
  ])

  expect(map.get(circuitKey(CIRCUITIKZ_LANG, source))).toEqual({
    svg: '<svg id="tikz"></svg>',
  })
  expect(map.get(circuitKey(CIRCUIT_LANG, source))).toEqual({
    svg: '<svg id="yaml"></svg>',
  })
})

// 描けなかった図はそもそも運ばれてこない。エラーを作って詰めると圏外で
// 「描画に失敗しました」と出て、本文が悪いように見えてしまう
test('運ばれていない図は引けない (コードブロックとして出る)', () => {
  expect(
    offlineCircuitMap([]).get(circuitKey(CIRCUITIKZ_LANG, '\\draw (0,0);')),
  ).toBeUndefined()
})
