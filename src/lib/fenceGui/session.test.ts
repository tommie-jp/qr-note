import { panelHtml } from 'fence-kit/shell'
import type { Outgoing } from 'fence-kit/shell'
import { describe, expect, test } from 'vitest'
import { loadFenceEditors } from './editors'
import { createFenceGuiSession } from './session'

// **殻を QR ノートの側から組めるか** (docs/99)。上流 playground の
// session.test.ts の写し。処理系は**モックしない** — 上流の版を上げて殻の
// 約束が動いたら、ここで落ちる

const CASES = [
  { lang: 'breadboard', body: 'board: half\nparts:\n  R1: resistor a5 a10 330', to: 'a7' },
  { lang: 'perfboard', body: 'board: 16x8\nparts:\n  R1: resistor c3 c7 330', to: 'c4' },
] as const

describe.each(CASES)('$lang の殻', ({ lang, body, to }) => {
  // 文書は Markdown の全文。散文を前後に置いて、書き換えがフェンスの行だけに
  // 当たることも一緒に見る
  const open = async () => {
    let now = ['# 見出し', '', `\`\`\`${lang}`, body, '```', '', 'あとがき。'].join('\n')
    const sent: Outgoing[] = []
    const session = createFenceGuiSession({
      editors: await loadFenceEditors(),
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

    await session.handle({ kind: 'setField', part: 'R1', field: 'value', text: '1k' })

    expect(now()).toBe(was.replace('330', '1k'))
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
  test('板の 2 つの editor を開くたびに作る', async () => {
    const first = await loadFenceEditors()
    const second = await loadFenceEditors()

    expect(first.map((one) => one.language)).toEqual(['breadboard', 'perfboard'])
    expect(second[0]).not.toBe(first[0])
  })
})
