// デバッグコンソール (eruda) の出し入れの判断 (docs/30-ブラウザログ計画.md §2)。
//
// 判断だけをここに分ける。eruda 本体を触る側 (logging/erudaConsole.ts) はブラウザが
// 無いと動かず、テストで確かめられないため。

export const DEBUG_QUERY_KEY = 'debug'

// sessionStorage に覚える。**localStorage にはしない** — 常用の道具ではなく、
// 消し忘れて画面の隅に居座るのを避ける。タブを閉じれば消える
export const DEBUG_STORAGE_KEY = 'qr-search:debug-console'

// URL に ?debug=1 / ?debug=0 があればそれに従い、無ければ覚えている印を継ぐ。
// 印を継ぐのが要点で、SPA 遷移でクエリが消えても・再読み込みしても出続ける
// (iPhone のアドレス欄で毎回打ち直すのは苦行)
export function debugEnabledFor(search: string, stored: boolean): boolean {
  const value = new URLSearchParams(search).get(DEBUG_QUERY_KEY)
  if (value === '1') {
    return true
  }
  if (value === '0') {
    return false
  }
  return stored
}
