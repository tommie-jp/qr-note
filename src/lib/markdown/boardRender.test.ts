import { describe, expect, test } from 'vitest'
import { renderBoardFence } from './boardRender'
import {
  BREADBOARD_LANG,
  COPPER_LANG,
  GRAPH_LANG,
  LOGIC_LANG,
  PERFBOARD_LANG,
  SCOPE_LANG,
  SPECTRUM_LANG,
  VNA_LANG,
} from './fenceLanguages'

// 処理系 (breadboard-fence / perfboard-fence) は**本物を使う**。モックにすると、
// 上流の版を上げたときに図が変わったことを試験が教えてくれない
// (circuit の yaml.test.ts と同じ立て付け)

const breadboard = `board: half
parts:
  R1: resistor a5 a10 330
  D1: led b12(A) b13(K) red
wires:
  - +t5 -- a5 red
  - a10 -- b12
`

const perfboard = `board: 28x18
parts:
  R1: resistor b2 b7 1k
wires:
  - b7 -- d7
`

describe('renderBoardFence', () => {
  test('ブレッドボードの図を、外部を参照しない SVG として返す', async () => {
    const { svg, issues } = await renderBoardFence(BREADBOARD_LANG, breadboard)

    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).not.toContain('<script')
    // 外へ読みに行かない。**xmlns は別** — あれは名前空間の名札で、取得はしない
    expect(/(?:href|url\()\s*['"]?https?:/i.test(svg)).toBe(false)
    expect(svg.replace(/xmlns[^=]*="[^"]*"/g, '')).not.toContain('http')
    expect(issues).toEqual([])
  })

  test('ユニバーサル基板の図も同じ形で返る', async () => {
    const { svg } = await renderBoardFence(PERFBOARD_LANG, perfboard)

    expect(svg.startsWith('<svg')).toBe(true)
  })

  // **読めない行があっても図は出る。** 板は既定を持つので、読めたところまで
  // 描いて行番号つきで言う (上流 52 の docs/54)。図が消えると直す手がかりも消える
  test('読めない行があっても図を返し、行番号つきで言う', async () => {
    const { svg, issues } = await renderBoardFence(
      BREADBOARD_LANG,
      'board: half\nparts:\n  R1: resistor a5 a10 330\n  R2: resistr zz9 zz9\n',
    )

    expect(svg.startsWith('<svg')).toBe(true)
    const hard = issues.filter((issue) => !issue.notice)
    expect(hard.length).toBeGreaterThan(0)
    expect(hard[0].line).toBe(4)
  })

  // 空でも既定の板を描く。図が出ないと、書き始める場所が画面に無い
  test('空のフェンスでも板を描く', async () => {
    const { svg } = await renderBoardFence(PERFBOARD_LANG, '')

    expect(svg.startsWith('<svg')).toBe(true)
  })

  test('知らない言語は断る', async () => {
    await expect(
      renderBoardFence('circuit' as never, breadboard),
    ).rejects.toThrow('知らないフェンス言語です')
  })

  // 危ないものが混ざっていないことは**許可リストが見る**。ここが通る = 回路図の
  // SVG と同じ検査を通っている (safeSvg.ts。写しではなく同じ関数)
  test('図は回路図と同じ許可リストを通っている', async () => {
    const { svg } = await renderBoardFence(PERFBOARD_LANG, perfboard)
    const elements = new Set(
      [...svg.matchAll(/<([a-zA-Z][\w:.-]*)[\s>]/g)].map((m) => m[1].toLowerCase()),
    )

    // 通った以上は許可リストの中だが、何が出ているかを字にしておく
    // (上流が新しい要素を使い始めたら、ここが変わって気づける)
    expect([...elements].sort()).toEqual(['circle', 'clippath', 'g', 'line', 'rect', 'svg', 'text'])
  })
})

// 計器の画面・寸法図 (docs/103)。**処理系は本物**。例は上流の文法書の最小のもの
describe('計器の画面と寸法図 (docs/103)', () => {
  // 上流の examples/ から、`data:` を持たない最小のものを写した (本物の文法で書かれている)
  const SAMPLES = [
    [VNA_LANG, `sweep: 1M-300M
title: 図02 白黒で刷る
dut: series R 100
traces:
  - S21 logmag
  - S11 smith
style:
  theme: mono
  width: 520
  stamp: on
`],
    [SCOPE_LANG, `title: 図02 1:2 — 8 の字
view: xy
ch1: sine 2kHz 1V
ch2: sine 1kHz 1V
xy: ch1 ch2
`],
    [SPECTRUM_LANG, `title: 図02 Hann — 山は 1.4 dB 低く、裾は速く落ちる
device: ad2
center: 1kHz
span: 200Hz
samples: 1024
window: hann
signal: sine 1002.375Hz 1V
markers:
  - peak
`],
    [GRAPH_LANG, `title: 図01 ダイオードの I-V — 縦を対数にすると直線
x: 電圧 V 0.2..0.8
y: 電流 mA log 1u..10
lines:
  1N4148 mA: 4.4n * (exp(x / (1.9 * 25.9m)) - 1) * 1000
notes:
  - mark 0.6
`],
    [LOGIC_LANG, `title: 図01 9600 baud の "Hi" — 0x48 と 0x69
device: ad3
time: 250us/div
sample: 1MHz
signals:
  TXD: dio0 pattern 10000100101010010110111 bit 104.17us
decode:
  Serial: uart TXD baud 9600 8N1 ascii
cursors: [500us, 1.5ms]
`],
    [COPPER_LANG, `board: 40x20mm
title: 図01 50Ω のスルー線路
f: 2.4G
copper:
  L1: line 0,10 40,10 3.06mm
parts:
  J1: sma left 10 CH0
  J2: sma right 10 CH1
`],
  ] as const

  test.each(SAMPLES)('%s は SVG を返し、読めない行が無い', async (lang, source) => {
    const { svg, issues } = await renderBoardFence(lang, source)

    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).not.toContain('<script')
    // お知らせ (notice) は許す。**読めなかった行** (notice: false) が 0 であること
    expect(issues.filter((issue) => !issue.notice)).toEqual([])
  })

  test('data: の添付は渡した関数から読まれる', async () => {
    const asked: string[] = []
    const source = 'x: 電圧 V 0.2..0.8\ny: 電流 mA 0..10\ndata: sweep.csv\n'

    await renderBoardFence(GRAPH_LANG, source, {
      data: (name) => {
        asked.push(name)
        return '100,0\n1000,-3\n10000,-20\n'
      },
    })

    expect(asked).toEqual(['sweep.csv'])
  })

  test('data: を渡さなくても図は出る (理想だけ)', async () => {
    const source = 'x: 電圧 V 0.2..0.8\ny: 電流 mA 0..10\ndata: sweep.csv\n'

    const { svg } = await renderBoardFence(GRAPH_LANG, source)

    expect(svg.startsWith('<svg')).toBe(true)
  })
})
