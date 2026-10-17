// ページ (page.tsx) の冒頭に置く門番 (docs/93-リファクタリング計画.md §4-8)。
// ルートハンドラの門番 (route/guard.ts) と同じく、同じ形の数行が各ページに
// 逐語で並んでいたものを 1 か所にした。どちらも notFound() / 例外で抜けるので、
// 通過した後の行は「番号が正しい」「ログイン中」を前提に書ける。
//
// proxy.ts も未ログインの画面 GET を止めるが、それは楽観的な検査であって
// 唯一の砦にはしない (docs/18 §4)。
import 'server-only'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { isDemoMode } from '../appEnv'
import { resolveItemKey } from '../items/resolve'
import { isAdminUser } from './admin'
import { currentUser, requireUser } from './session'
import { isLegacyItemNo, isValidItemId } from '../validation'

// ノートを URL に持つページ (/item・/print・/edit・/item/…/history) の門番。
// 通過すれば id (UUID) が返る (docs/107-ノート主キー計画.md §3-2)。
//
//   UUID          → そのまま返す (行があるかは各ページが見る)
//   旧番号 1 件   → 301 で id の URL へ。X や検索エンジンが覚えた旧 URL を
//                   付け替えてもらうため永久の転送にする
//   旧番号 0/複数 → 検索へ (状況で変わるので一時の転送)
//   形が違う      → DB を引くまでもなく 404
//
// pathOf は「id からこのページの URL を作る」関数。/item/1003/history のように
// 後ろに続きがあるページも、続きごと付け替える
export async function guardItemPage(
  key: string,
  pathOf: (itemId: string) => string,
): Promise<string> {
  if (isValidItemId(key)) {
    return key
  }
  if (!isLegacyItemNo(key)) {
    notFound()
  }
  // 未ログインかどうかは旧番号のときだけ要る (UUID なら DB に触らずに返す)
  const user = await currentUser()
  const resolution = await resolveItemKey(key, { publicOnly: user === null })
  if (resolution.kind === 'legacy') {
    permanentRedirect(pathOf(resolution.itemId))
  }
  if (resolution.kind === 'search') {
    redirect(resolution.href)
  }
  notFound()
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

// 管理者だけの設定ページ (/settings/server。docs/109-サーバー情報計画.md §2)。
// 設定系の門番を通した上で、管理者でなければ 404 — 403 にすると
// 「そういう画面がある」と教えることになる。導線 (メニュー) も同じ判定で
// 隠すが、URL 直打ちに備えてページ側でも倒す
export async function requireAdminPage(): Promise<string> {
  const user = await requireSettingsPage()
  if (!isAdminUser(user)) {
    // 404 で黙って返すが、/logs には残す — ログイン済みの誰かが管理者の URL を
    // 直打ちしたことは、後から気づけるべき
    console.warn(`管理者でないユーザーが管理者ページを開こうとした (user=${user})`)
    notFound()
  }
  return user
}
