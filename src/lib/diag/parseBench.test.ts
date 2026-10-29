import { expect, test } from 'vitest'
import { extractCircuitFences } from '../circuit/fences'
import { BENCH_FIXTURE_MD } from './benchFixture'
import { parseBatch, parseCircuitStaged } from './parseBench'

test('段階に分けた抽出は本番の extractCircuitFences と同じ結果になる', () => {
  // Act
  const { fences } = parseCircuitStaged(BENCH_FIXTURE_MD)

  // Assert
  expect(fences).toEqual(extractCircuitFences(BENCH_FIXTURE_MD))
})

test('見本には回路フェンスが 5 つ (circuit 4 + circuitikz 1) ある', () => {
  const { fences } = parseCircuitStaged(BENCH_FIXTURE_MD)

  expect(fences.map((f) => f.lang)).toEqual(['circuit', 'circuit', 'circuit', 'circuit', 'circuitikz'])
})

test('重複と空のフェンスは本番と同じく畳む', () => {
  const memo = ['```circuit', 'a', '```', '', '```circuit', 'a', '```', '', '```circuit', '```'].join('\n')

  expect(parseCircuitStaged(memo).fences).toEqual(extractCircuitFences(memo))
})

test('段階は時計の差で測り、全体は段階の和', async () => {
  // Arrange: 呼ばれるたびに 1 進む時計 (1 件あたり 4 回読む)
  let clock = 0
  const now = () => clock++

  // Act
  const r = await parseBatch([BENCH_FIXTURE_MD, BENCH_FIXTURE_MD], { now })

  // Assert
  expect(r.stages).toEqual({ sha1: 2, 解析: 2, 抽出: 2 })
  expect(r.totalMs).toBe(6)
  expect(r.fences).toBe(10)
})
