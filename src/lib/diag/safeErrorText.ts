// 画面とコピー文面に出す失敗の理由 (docs/109-サーバー情報計画.md §2)。
//
// errorText() の文言をそのまま出すと、DB のドライバが接続文字列ごと
// (パスワード入りの URL) を message に入れてくる余地がある。管理者限定の
// 画面でも、コピーした文面はチャットやスクショに貼られる。URL の形は丸ごと
// 伏せ、長さも切る。詳しい理由は console.warn で /logs 側に残っている
// (serverInfo.ts) ので、ここで削っても調査の手がかりは失わない
import { errorText } from '../errorMessage'

export const SAFE_ERROR_MAX_LENGTH = 200
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi
const URL_PLACEHOLDER = '[url]'

export function safeErrorText(error: unknown): string {
  const text = errorText(error).replace(URL_PATTERN, URL_PLACEHOLDER).replace(/\s+/g, ' ').trim()
  return text.length > SAFE_ERROR_MAX_LENGTH ? `${text.slice(0, SAFE_ERROR_MAX_LENGTH)}…` : text
}
