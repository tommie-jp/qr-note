import { expect, test } from 'vitest'

import { offlineCircuitMap } from './circuits'

// MarkdownView が引く鍵は**フェンスの中身 (trim 済み)** そのもの。
// ここがずれると図を引けず、圏外でだけコードブロックのまま出る
test('フェンスの中身を鍵にしたマップを作る', () => {
  // Arrange
  const source = '\\draw (0,0) to[R] (2,0);'

  // Act
  const map = offlineCircuitMap([{ source, svg: '<svg id="a"></svg>' }])

  // Assert
  expect(map.get(source)).toEqual({ svg: '<svg id="a"></svg>' })
})

// 描けなかった図はそもそも運ばれてこない。エラーを作って詰めると圏外で
// 「描画に失敗しました」と出て、本文が悪いように見えてしまう
test('運ばれていない図は引けない (コードブロックとして出る)', () => {
  expect(offlineCircuitMap([]).get('\\draw (0,0);')).toBeUndefined()
})
