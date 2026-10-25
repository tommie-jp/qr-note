import { describe, expect, test } from 'vitest'
import { pickDroppedFile } from './dropFile'

const file = (name: string) => new File(['x'], name)

describe('pickDroppedFile', () => {
  test('1 つならそれを送る', () => {
    const only = file('a.mp4')

    expect(pickDroppedFile([only])).toEqual({ file: only })
  })

  // 枠は 1 つ。先頭だけ黙って送ると、残りが届いたと思い込む
  test('2 つ以上は黙って先頭だけ送らず、理由を返す', () => {
    expect(pickDroppedFile([file('a.mp4'), file('b.mp4')])).toEqual({
      error: 'ファイルは 1 つずつ送ってください (サーバの枠は 1 つです)',
    })
  })

  test('何も無ければ無視する (null)', () => {
    expect(pickDroppedFile([])).toBeNull()
  })
})
