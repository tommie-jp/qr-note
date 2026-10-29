import { SourceMap } from 'node:module'
import { describe, expect, test } from 'vitest'
import { type CpuProfile, moduleOf, remapProfile, summarizeByModule } from './profileRemap'

const BUNDLE = 'file:///app/.next/server/chunks/ssr/_abc._.js'

// 束ねの 0 行 0 列 → micromark の lib/create-tokenizer.js の 10 行目、名前 main
const MAP = new SourceMap({
  version: 3,
  file: '_abc._.js',
  sourceRoot: '',
  sourcesContent: [],
  sources: ['../../../../node_modules/micromark/lib/create-tokenizer.js'],
  names: ['main'],
  mappings: 'AASAA',
})

const frame = (id: number, url: string, functionName = 'h', lineNumber = 0) => ({
  id,
  callFrame: { functionName, scriptId: '1', url, lineNumber, columnNumber: 0 },
})

const PROFILE: CpuProfile = {
  nodes: [frame(1, ''), frame(2, BUNDLE), frame(3, 'node:internal/util', 'fn', 3), frame(4, 'file:///app/.next/server/chunks/ssr/_nomap._.js')],
  startTime: 0,
  endTime: 1000,
  // 最初のサンプルの前はプロファイラの起動の待ちで、集計に入れない
  samples: [2, 2, 2, 3, 1],
  timeDeltas: [900_000, 300, 300, 200, 200],
}

describe('moduleOf', () => {
  test.each([
    ['../../../../node_modules/micromark/lib/x.js', 'micromark'],
    ['../../node_modules/mdast-util-find-and-replace/node_modules/escape-string-regexp/index.js', 'escape-string-regexp'],
    ['../../node_modules/@scope/pkg/lib/x.js', '@scope/pkg'],
    ['../../../../src/lib/diag/parseBench.ts', 'src/lib/diag'],
    ['node:internal/util', 'node:'],
    ['', '(V8)'],
    [BUNDLE, '(束ね・引き直せず)'],
  ])('%s → %s', (url, name) => {
    expect(moduleOf(url)).toBe(name)
  })
})

describe('remapProfile', () => {
  test('.map のある束ねは元のパス・行・名前に替え、元の url を残す', () => {
    const out = remapProfile(PROFILE, (url) => (url === BUNDLE ? MAP : null))

    expect(out.nodes[1].callFrame).toMatchObject({
      url: '../../../../node_modules/micromark/lib/create-tokenizer.js',
      lineNumber: 9,
      functionName: 'main',
      bundleUrl: BUNDLE,
    })
  })

  test('.map の無い束ね・node: の枠はそのまま', () => {
    const out = remapProfile(PROFILE, () => null)

    expect(out.nodes).toEqual(PROFILE.nodes)
  })

  test('同じ束ねの .map は 1 度だけ読む', () => {
    let reads = 0
    const twice: CpuProfile = { ...PROFILE, nodes: [frame(1, BUNDLE), frame(2, BUNDLE)] }

    remapProfile(twice, () => {
      reads += 1
      return MAP
    })

    expect(reads).toBe(1)
  })
})

test('summarizeByModule は最初のサンプルを除いた自己時間をモジュールごとに畳む', () => {
  const remapped = remapProfile(PROFILE, (url) => (url === BUNDLE ? MAP : null))

  expect(summarizeByModule(remapped)).toEqual([
    { module: 'micromark', ms: 0.6, pct: 60 },
    { module: 'node:', ms: 0.2, pct: 20 },
    { module: '(V8)', ms: 0.2, pct: 20 },
  ])
})
