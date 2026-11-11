// スクロールバーを出すか (docs/11 §6-8)。端末ごと。
//
// 既定は**隠す**。ペインが 3 つ並ぶと、各ペインのバーが縦に何本も並んで狭い画面の
// 幅を食う。隠してもホイール・指・キーでのスクロールはそのまま効く。
// 選ぶのはハンバーガーメニューの「スクロールバー」。値は html の data-scrollbars に
// 書き、globals.css がそれを見てバーを消す。読み込み直後は <head> の先回り
// スクリプトで当てる (バーが一瞬出てから消えると、幅が変わって中身が揺れる)
export type ScrollbarMode = 'hidden' | 'shown'

export const SCROLLBARS_STORAGE_KEY = 'qr-search:scrollbars'
export const DEFAULT_SCROLLBAR_MODE: ScrollbarMode = 'hidden'
const ATTRIBUTE = 'data-scrollbars'

export function parseScrollbarMode(raw: string | null): ScrollbarMode {
  return raw === 'shown' || raw === 'hidden' ? raw : DEFAULT_SCROLLBAR_MODE
}

export function loadScrollbarMode(storage: Storage | null): ScrollbarMode {
  try {
    return parseScrollbarMode(storage?.getItem(SCROLLBARS_STORAGE_KEY) ?? null)
  } catch {
    return DEFAULT_SCROLLBAR_MODE
  }
}

// 端末へ覚えて、いまの画面にも当てる (書けなくても画面には当てる)
export function applyScrollbarMode(storage: Storage | null, mode: ScrollbarMode): void {
  document.documentElement.setAttribute(ATTRIBUTE, mode)
  try {
    storage?.setItem(SCROLLBARS_STORAGE_KEY, mode)
  } catch {
    // iOS のプライベート閲覧など。次の読み込みでは既定に戻るだけ
  }
}

// 初回描画の前に html へ書く。読めなければ既定
export const SCROLLBARS_INIT_SCRIPT = `(function(){var m=${JSON.stringify(DEFAULT_SCROLLBAR_MODE)};try{var v=localStorage.getItem(${JSON.stringify(SCROLLBARS_STORAGE_KEY)});if(v==="shown"||v==="hidden")m=v}catch(e){}document.documentElement.setAttribute(${JSON.stringify(ATTRIBUTE)},m)})()`
