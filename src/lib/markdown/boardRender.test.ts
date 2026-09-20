import { describe, expect, test } from 'vitest'
import { renderBoardFence } from './boardRender'
import { BREADBOARD_LANG, PERFBOARD_LANG } from './fenceLanguages'

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
    expect([...elements].sort()).toEqual(['circle', 'g', 'line', 'rect', 'svg', 'text'])
  })
})
