// ブラウザからサーバへログを送る手段 (docs/30-ブラウザログ計画.md §1)。
// ブラウザ / Worker でしか動かないので、拾う側 (logging/clientCapture.ts) とは分ける。

import { CLIENT_LOG_PATH, type ClientLogItem } from './clientPayload'

// Beacon を優先する。**ページ離脱時に届くのはこれだけ** で、遷移直前の
// エラーこそ一番失いたくない。fetch は離脱で中断されうる。
// Beacon が無い / 断られた (キュー上限) ときだけ fetch に落ちる。
//
// どちらも同一オリジンなので Cookie は付き、Sec-Fetch-Site も same-origin に
// なる (受け口の denyCrossSite が見る)。
export function sendClientLogs(items: ClientLogItem[]): void {
  const body = JSON.stringify({ items })

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    // Blob で型を付ける。付けないと text/plain 扱いになり、受け口の
    // request.json() まで届いても内容の意図が読めない
    const queued = navigator.sendBeacon(
      CLIENT_LOG_PATH,
      new Blob([body], { type: 'application/json' }),
    )
    if (queued) {
      return
    }
  }

  // 失敗しても何もしない。ここで console.error を呼ぶと
  // 「送れない → エラー → 送る」の無限ループになる (logging/clientCapture.ts と同じ理由)
  void fetch(CLIENT_LOG_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}
