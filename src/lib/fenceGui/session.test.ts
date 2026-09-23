import { panelHtml } from 'fence-kit/shell'
import type { Outgoing } from 'fence-kit/shell'
import { describe, expect, test } from 'vitest'
import { loadFenceEditors } from './editors'
import { createFenceGuiSession } from './session'

// **殻を QR ノートの側から組めるか** (docs/99)。上流 playground の
// session.test.ts の写し。処理系は**モックしない** — 上流の版を上げて殻の
// 約束が動いたら、ここで落ちる

// value は属性の欄で直す前の値、next は直した後の値
const CASES = [
  { lang: 'breadboard', body: 'board: half\nparts:\n  R1: resistor a5 a10 330', to: 'a7', value: '330', next: '1k' },
  { lang: 'perfboard', body: 'board: 16x8\nparts:\n  R1: resistor c3 c7 330', to: 'c4', value: '330', next: '1k' },
  // 回路図 (docs/100)。掴むのは清書ではなく、つながりだけの簡略図 (TeX は要らない)
  { lang: 'circuit', body: 'parts:\n  R1: resistor a1 a2 10k', to: 'b1', value: '10k', next: '4k7' },
] as const

describe.each(CASES)('$lang の殻', ({ lang, body, to, value, next }) => {
  // 文書は Markdown の全文。散文を前後に置いて、書き換えがフェンスの行だけに
  // 当たることも一緒に見る
  const open = async () => {
    let now = ['# 見出し', '', `\`\`\`${lang}`, body, '```', '', 'あとがき。'].join('\n')
    const sent: Outgoing[] = []
    const session = createFenceGuiSession({
      editors: await loadFenceEditors([lang]),
      text: () => now,
      setText: (next) => {
        now = next
      },
      // 本文の 1 行目 (見出し 0 / 空 1 / 開き 2 → 本文 3)
      fenceLine: () => 3,
      onBind: () => {},
      post: (message) => sent.push(message),
    })
    return { session, sent, now: () => now }
  }

  test('殻の頁を組める (図と掴む層が入る)', async () => {
    // Arrange
    const { session } = await open()

    // Act
    const html = panelHtml({
      cspSource: "'self'",
      nonce: 'test',
      scriptUri: '/fence/map.web.js',
      view: session.view(),
      undo: 'own',
    })

    // Assert
    expect(html).toContain('<svg')
    expect(html).toContain('data-part="R1"')
  })

  test('掴んで動かすとフェンスの行だけが書き換わる', async () => {
    const { session, now } = await open()
    const was = now()

    await session.handle({ kind: 'move', part: 'R1', to })

    expect(now()).not.toBe(was)
    expect(now()).toContain(to)
    const lines = now().split('\n')
    expect(lines[0]).toBe('# 見出し')
    expect(lines.at(-1)).toBe('あとがき。')
  })

  test('属性の欄で値を変えると、その行の値だけが変わる', async () => {
    const { session, now } = await open()
    const was = now()

    await session.handle({ kind: 'setField', part: 'R1', field: 'value', text: next })

    expect(now()).toBe(was.replace(value, next))
  })

  test('殻の中で戻すと元の本文に返る', async () => {
    const { session, now } = await open()
    const was = now()
    await session.handle({ kind: 'move', part: 'R1', to })

    await session.handle({ kind: 'undo' })

    expect(now()).toBe(was)
  })
})

describe('loadFenceEditors', () => {
  // 読むのは渡した言語の分だけ (docs/100 の決め 3)
  test('渡した言語の editor を、その順で作る', async () => {
    const editors = await loadFenceEditors(['circuit', 'breadboard'])

    expect(editors.map((one) => one.language)).toEqual(['circuit', 'breadboard'])
  })

  test('言語が無ければ何も読まない', async () => {
    expect(await loadFenceEditors([])).toEqual([])
  })

  test('開くたびに作り直す (殻 1 つに 1 組)', async () => {
    const [first] = await loadFenceEditors(['perfboard'])
    const [second] = await loadFenceEditors(['perfboard'])

    expect(second).not.toBe(first)
  })
})
