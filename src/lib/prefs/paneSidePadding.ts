// ペインの左右の余白 (docs/86 §4-20)。端末ごと。
//
// 選ぶ場所はカレンダーの設定の「月の左右の余白」(0 / 小 / 中) で、正本はその設定
// (端末の localStorage)。カレンダーの控えが値を読んだ・変えたときにここへ写し、
// フォルダーペインもこの CSS 変数を左右の余白に使う — 一覧表示でも同じ余白になる。
//
// 読み込み直後は <head> の先回りスクリプトで当てる (ペインの寸法と同じ作り)。
// 一度も選んでいない端末は CSS の既定 (var の第 2 引数) の 1rem = 「中」
import { makeCssVarInitScript } from './cssVarInitScript'

export const PANE_SIDE_PADDING = {
  storageKey: 'pane-side-pad',
  cssVar: '--pane-side-pad',
  unit: 'px',
  min: 0,
  max: 16,
} as const

// カレンダーの設定の段 (0 / 小 / 中) と px
export const SIDE_PADDING_PX = { none: 0, sm: 8, md: 16 } as const

// 端末へ写して、いまの画面にも当てる (書けなくても画面には当てる)
export function applyPaneSidePadding(px: number): void {
  document.documentElement.style.setProperty(PANE_SIDE_PADDING.cssVar, `${px}px`)
  try {
    localStorage.setItem(PANE_SIDE_PADDING.storageKey, String(px))
  } catch {
    // iOS のプライベート閲覧など。次の読み込みでは既定に戻るだけ
  }
}

export const PANE_SIDE_PADDING_INIT_SCRIPT = makeCssVarInitScript({
  normalize: 'clamp',
  targets: [PANE_SIDE_PADDING],
})
