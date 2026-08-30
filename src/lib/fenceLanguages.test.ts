import { describe, expect, test } from 'vitest'
import {
  CIRCUITIKZ_LANG,
  FENCE_LANGUAGES,
  HEALTH_LANG,
  MATRIX_LANG,
  MERMAID_LANG,
  QUIZ_LANG,
  RENDERED_LANGS,
  editDistance,
  suggestFenceLang,
} from './fenceLanguages'

describe('language lists', () => {
  test('補完候補に特別扱いの 5 言語を含む', () => {
    expect(FENCE_LANGUAGES).toContain(CIRCUITIKZ_LANG)
    expect(FENCE_LANGUAGES).toContain(MERMAID_LANG)
    expect(FENCE_LANGUAGES).toContain(QUIZ_LANG)
    expect(FENCE_LANGUAGES).toContain(MATRIX_LANG)
    expect(FENCE_LANGUAGES).toContain(HEALTH_LANG)
  })

  test('候補は重複なし', () => {
    expect(new Set(FENCE_LANGUAGES).size).toBe(FENCE_LANGUAGES.length)
  })

  test('描画対象は circuitikz と mermaid と quiz と matrix と health のみ', () => {
    expect([...RENDERED_LANGS]).toEqual([
      CIRCUITIKZ_LANG,
      MERMAID_LANG,
      QUIZ_LANG,
      MATRIX_LANG,
      HEALTH_LANG,
    ])
  })

  test('補完候補の他の言語を打ち間違い扱いしない', () => {
    // quiz / matrix / health を描画対象に足したことで、既存の候補語
    // (sql / lua / html など) が「quiz の間違いでは?」と叱られないことを確かめる
    for (const lang of FENCE_LANGUAGES) {
      expect(suggestFenceLang(lang)).toBeNull()
    }
  })
})

describe('editDistance', () => {
  test('同一語は 0', () => {
    expect(editDistance('mermaid', 'mermaid', 2)).toBe(0)
  })

  test('1 文字削除は 1 (circuitkz → circuitikz)', () => {
    expect(editDistance('circuitkz', 'circuitikz', 2)).toBe(1)
  })

  test('隣接転置は 1 として数える (mermiad → mermaid)', () => {
    expect(editDistance('mermiad', 'mermaid', 2)).toBe(1)
  })

  test('1 文字置換は 1', () => {
    expect(editDistance('mermayd', 'mermaid', 2)).toBe(1)
  })

  test('上限を超えたら打ち切って max+1 を返す', () => {
    expect(editDistance('rust', 'circuitikz', 2)).toBeGreaterThan(2)
  })
})

describe('suggestFenceLang', () => {
  test('1 文字抜けを図の言語として提案する (ユーザーが踏んだ例)', () => {
    expect(suggestFenceLang('circuitkz')).toBe(CIRCUITIKZ_LANG)
  })

  test('入れ替わり誤字を提案する (補完では拾えない例)', () => {
    expect(suggestFenceLang('mermiad')).toBe(MERMAID_LANG)
  })

  test('大文字小文字だけ違うものも正しい綴りを提案する', () => {
    expect(suggestFenceLang('Mermaid')).toBe(MERMAID_LANG)
    expect(suggestFenceLang('CircuitikZ')).toBe(CIRCUITIKZ_LANG)
  })

  test('完全一致は問題なし (null)', () => {
    expect(suggestFenceLang(CIRCUITIKZ_LANG)).toBeNull()
    expect(suggestFenceLang(MERMAID_LANG)).toBeNull()
  })

  test('正当な別言語は放置する (null)', () => {
    for (const lang of ['bash', 'text', 'json', 'python', 'rust', 'go', 'sql']) {
      expect(suggestFenceLang(lang)).toBeNull()
    }
  })

  test('短すぎる語・空は対象外', () => {
    expect(suggestFenceLang('')).toBeNull()
    expect(suggestFenceLang('js')).toBeNull()
  })

  test('遠い綴りは提案しない', () => {
    expect(suggestFenceLang('markdown')).toBeNull()
  })
})
