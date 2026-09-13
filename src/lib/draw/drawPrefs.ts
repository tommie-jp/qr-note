// お絵かきの色と太さの持ち越し (docs/34-お絵かき計画.md §4)。
//
// 前に使った色でそのまま描き始められるよう localStorage に残す。
// 読み出しは信用しない — 手で書き換えられる値なので、色は書式を、太さは
// 選択肢に在ることを検算してから使う (外れていれば既定へ寄せる)。

import 'client-only'

// localStorage のうち、ここで使う分だけの形。テストから差し替えられるように
// 具象の Storage ではなくこの幅で受ける
export interface PrefsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface DrawPrefs {
  readonly color: string
  readonly width: number
}

export const DRAW_PREFS_KEY = 'qr-search-draw'

// 太さの選択肢。スマホのドロップダウンで選ぶので刻みは粗く、
// 細字 (1) から太いマーカー (24) まで届かせる
export const DRAW_WIDTH_OPTIONS = [1, 2, 4, 6, 8, 12, 16, 24] as const

// 写真の上に描いても埋もれない赤を既定にする
export const DEFAULT_DRAW_COLOR = '#ff3b30'
export const DEFAULT_DRAW_WIDTH = 6

// <input type="color"> が返すのと同じ 6 桁の 16 進だけ通す
const COLOR_RE = /^#[0-9a-f]{6}$/i

function validColor(value: unknown): string {
  return typeof value === 'string' && COLOR_RE.test(value) ? value : DEFAULT_DRAW_COLOR
}

function validWidth(value: unknown): number {
  return DRAW_WIDTH_OPTIONS.includes(value as (typeof DRAW_WIDTH_OPTIONS)[number])
    ? (value as number)
    : DEFAULT_DRAW_WIDTH
}

export function loadDrawPrefs(storage: PrefsStorage | null | undefined): DrawPrefs {
  const fallback: DrawPrefs = { color: DEFAULT_DRAW_COLOR, width: DEFAULT_DRAW_WIDTH }
  if (!storage) {
    return fallback
  }
  try {
    const raw = storage.getItem(DRAW_PREFS_KEY)
    if (!raw) {
      return fallback
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return fallback
    }
    const { color, width } = parsed as Record<string, unknown>
    return { color: validColor(color), width: validWidth(width) }
  } catch {
    // 壊れた JSON もプライベートモードの拒否も、既定で描き始められれば足りる
    return fallback
  }
}

export function saveDrawPrefs(
  storage: PrefsStorage | null | undefined,
  prefs: DrawPrefs,
): void {
  if (!storage) {
    return
  }
  try {
    storage.setItem(DRAW_PREFS_KEY, JSON.stringify({ color: prefs.color, width: prefs.width }))
  } catch {
    // 容量超過・プライベートモード。持ち越せないだけで描画には影響しない
  }
}
