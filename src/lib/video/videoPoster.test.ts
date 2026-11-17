import { expect, test } from 'vitest'
import { collectFrames, type FrameSource } from './videoPoster'

// コマ集め (collectFrames) の打ち切り方を固定する。動画要素と canvas は
// 使わず、シーク・描画・時計を差し替えて見る

const blob = (label: string) => new Blob([label])

// 呼ばれたシーク先を控え、描画は順に blob を返す手足
function fakeSource({
  seekOk = () => true,
  drawOk = () => true,
  tick = 0,
}: {
  seekOk?: (sec: number) => boolean
  drawOk?: (count: number) => boolean
  tick?: number
} = {}): FrameSource & { seeks: number[] } {
  const seeks: number[] = []
  let clock = 0
  let draws = 0
  return {
    seeks,
    seek: async (sec) => {
      seeks.push(sec)
      return seekOk(sec)
    },
    draw: async () => {
      draws += 1
      return drawOk(draws) ? blob(`frame${draws}`) : null
    },
    now: () => {
      clock += tick
      return clock
    },
  }
}

test('全部の時刻でコマを描き、1 コマ目はシークしない', async () => {
  const source = fakeSource()

  const frames = await collectFrames([0.1, 1, 2], source)

  expect(frames).toHaveLength(3)
  // 1 コマ目は poster と同じ位置なので、シークは 2 コマ目から
  expect(source.seeks).toEqual([1, 2])
})

test('シークに失敗したら、そこまでのコマで打ち切る', async () => {
  const source = fakeSource({ seekOk: (sec) => sec < 2 })

  const frames = await collectFrames([0.1, 1, 2, 3], source)

  expect(frames).toHaveLength(2)
  expect(source.seeks).toEqual([1, 2])
})

test('描けなかったコマで打ち切る', async () => {
  const source = fakeSource({ drawOk: (count) => count < 2 })

  const frames = await collectFrames([0.1, 1, 2], source)

  expect(frames).toHaveLength(1)
})

test('予算を過ぎたら、間に合ったぶんだけ返す', async () => {
  // now() を呼ぶたびに 10ms 進む。締切は 25ms 後 (最初の呼び出しが 10)
  const source = fakeSource({ tick: 10 })

  const frames = await collectFrames([0.1, 1, 2, 3, 4], source, 25)

  expect(frames).toHaveLength(2)
})

test('時刻が無ければ何もしない', async () => {
  const source = fakeSource()

  expect(await collectFrames([], source)).toEqual([])
  expect(source.seeks).toEqual([])
})
