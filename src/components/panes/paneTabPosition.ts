// 境界のタブの位置 (境界に沿った向き。docs/86 §4-21)。端末ごと。
//
// 縦の境界 (フォルダー) のタブは上下に、横の境界 (下のペイン) のタブは左右に
// ドラッグで動かせる。位置は「動ける範囲の何割か」(0〜1) で持つ — 画面の大きさが
// 変わっても範囲の中に収まる。ペインを隠した後の端のタブ (CollapsedPaneTabs) も
// 同じ位置に出す
import { useSyncExternalStore } from 'react'
import type { PaneKind } from '@/lib/prefs/paneSize'

const STORAGE_KEY: Record<PaneKind, string> = {
  folder: 'pane-tab-folder',
  preview: 'pane-tab-preview',
}
const DEFAULT_FRACTION = 0.5

// タブの長さ (境界に沿った向き)。PaneResizer の h-12 / w-12 と対
export const TAB_LENGTH_REM = 3

const memory = new Map<PaneKind, number>()
const listeners = new Set<() => void>()

export function clampFraction(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_FRACTION
  }
  return Math.min(1, Math.max(0, value))
}

// ポインタの位置 (境界に沿った座標) から割合を出す。タブの中心がポインタに来るようにし、
// タブが範囲の外へはみ出さないよう 0〜1 に止める
export function tabFraction(pointer: number, start: number, length: number, tabLength: number): number {
  const room = length - tabLength
  if (room <= 0) {
    return DEFAULT_FRACTION
  }
  return clampFraction((pointer - start - tabLength / 2) / room)
}

function read(kind: PaneKind): number {
  const remembered = memory.get(kind)
  if (remembered !== undefined) {
    return remembered
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY[kind])
    return raw === null ? DEFAULT_FRACTION : clampFraction(Number.parseFloat(raw))
  } catch {
    return DEFAULT_FRACTION
  }
}

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

// ドラッグ中の位置。端末にはまだ書かず、同じ境界のタブすべてに流す — カレンダーの
// 日の一覧のペインはノートのペインと境界が 2 本重なり、片方の中だけで動かすと
// もう片方のタブが古い位置に残る (docs/86 §4-24)
export function setLiveTabPosition(kind: PaneKind, fraction: number): void {
  memory.set(kind, clampFraction(fraction))
  notify()
}

// 離したとき。端末に覚える
export function setTabPosition(kind: PaneKind, fraction: number): void {
  const value = clampFraction(fraction)
  memory.set(kind, value)
  try {
    localStorage.setItem(STORAGE_KEY[kind], String(value))
  } catch {
    // 覚えられなくてもこのセッションの間は保つ
  }
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTabPosition(kind: PaneKind): number {
  return useSyncExternalStore(
    subscribe,
    () => read(kind),
    () => DEFAULT_FRACTION,
  )
}

// タブを置く CSS の長さ (範囲の始まりからの距離)。範囲の長さは CSS の式で渡す
export function tabOffsetCss(fraction: number, rangeCss: string): string {
  return `calc(${fraction} * (${rangeCss} - ${TAB_LENGTH_REM}rem))`
}
