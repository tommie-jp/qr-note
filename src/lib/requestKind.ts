// リクエストの種類の見分け (proxy の門番が使う。docs/18-ログイン計画.md)。
// Request を受けずメソッドとパスだけを受ける純関数 (テスト容易性)。

// 読み取りだけの要求か。isPageRequest と違って /api/ も含む
// (画像配信は読み取りだが API でもあるため)
export function isReadRequest(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

// 人がブラウザで開いている画面かどうか。Server Action は現在のページの URL へ
// POST されるため、メソッドを見ないと「保存」が案内ページに化けて黙って失敗する
export function isPageRequest(method: string, pathname: string): boolean {
  if (!isReadRequest(method)) {
    return false
  }
  return !pathname.startsWith('/api/')
}
