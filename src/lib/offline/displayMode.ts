// PWA の表示モード判定 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。
//
// **なぜ要るか**: ホーム画面から起動した PWA (standalone) にはタブも URL バーも
// 戻るボタンも無い。その状態で **manifest の scope 内**の URL を開くと、iOS は
// target="_blank" を無視して同じ webview を遷移させるため、戻る導線が無いまま
// 閉じ込められる (アプリを強制終了するしかない。実機で確認)。
//
// scope 外の外部リンク (https://...) で同じ問題が起きないのは、iOS がそれを
// Safari (別アプリ) で開くから。アプリスイッチャーで PWA へ戻れる。
// **閉じ込められるのは scope 内の同一オリジンだけ**なので、その導線を出すかどうかを
// ここで判定する。

// ブラウザ UI を持たない表示モード。どれも「戻るボタンが無い」点で同じ扱いにする
const APP_LIKE_DISPLAY_MODES = [
  '(display-mode: standalone)',
  '(display-mode: minimal-ui)',
  '(display-mode: fullscreen)',
]

// ホーム画面から起動した状態か。SSR では判定できないので false を返す
// (呼び出し側はマウント後に読み直すこと)。
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  if (APP_LIKE_DISPLAY_MODES.some((query) => window.matchMedia(query).matches)) {
    return true
  }
  // iOS Safari 独自のフラグ。古い iOS では display-mode が効かないことがあるため
  // 併せて見る
  return (
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

// 表示モードの変化を購読する (useSyncExternalStore 用)。
// 同じ端末でもブラウザで開いたままホーム画面へ追加する等で変わりうるので、
// 一度読んで終わりにはしない。購読できない環境では何もしない解除関数を返す。
export function subscribeDisplayMode(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const lists = APP_LIKE_DISPLAY_MODES.map((query) => window.matchMedia(query))
  for (const list of lists) {
    list.addEventListener('change', onChange)
  }
  return () => {
    for (const list of lists) {
      list.removeEventListener('change', onChange)
    }
  }
}
