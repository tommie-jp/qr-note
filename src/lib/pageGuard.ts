// ページ (page.tsx) の冒頭に置く門番 (docs/93-リファクタリング計画.md §4-8)。
// ルートハンドラの門番 (route/guard.ts) と同じく、同じ形の数行が各ページに
// 逐語で並んでいたものを 1 か所にした。どちらも notFound() / 例外で抜けるので、
// 通過した後の行は「番号が正しい」「ログイン中」を前提に書ける。
//
// proxy.ts も未ログインの画面 GET を止めるが、それは楽観的な検査であって
// 唯一の砦にはしない (docs/18 §4)。
import 'server-only'
import { notFound } from 'next/navigation'
import { isDemoMode } from './appEnv'
import { requireUser } from './auth/session'
import { isValidItemNo } from './validation'

// ノート番号を URL に持つページ (/item・/print・/edit・/item/…/history)。
// 形の合わない番号は DB を引くまでもなく 404
export function guardItemPage(itemNo: string): void {
  if (!isValidItemNo(itemNo)) {
    notFound()
  }
}

// 設定系ページ (/settings/*)。デモでは設定系を出さない (docs/38-デモモード計画.md §4)
// — 導線 (ヘッダのリンク) も隠すが、URL 直打ちに備えてページ側でも 404 に倒す。
// デモの判定を先にするのは、デモならログインの有無に関わらず 404 にするため
export async function requireSettingsPage(): Promise<string> {
  if (isDemoMode()) {
    notFound()
  }
  return requireUser()
}
