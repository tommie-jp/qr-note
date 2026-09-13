import { isDemoMode } from '@/lib/appEnv'
import { requireUser } from '@/lib/session'

// サーバーアクションの門番 (docs/18-ログイン計画.md)。
//
// Server Action は「画面に置いたボタン」ではなく、誰でも叩ける POST の口
// (id さえ判れば画面を通さず呼べる)。proxy.ts も未ログインの POST は 401 に
// するが、それは楽観的な検査でしかないので、書き込む側でも必ず確かめる。
// ログインだけを見るアクションは本体の先頭で requireUser() を直に呼ぶ。
//
// **アクションを関数で包む形 (withAuth(async (...) => …)) にはしない。**
// Next はアクションの id の先頭 1 バイトに「どの引数を使うか」を焼き込み、
// クライアントは使わない引数を送らない (next/dist/shared/lib/server-reference-info.js)。
// 包むと引数が `...args` に見えて全部を送るようになる — 引数を持たない
// emptyTrashAction / backfillHistoryAction にも、押したフォームの中身が載る。
//
// **このファイルに 'use server' を付けない。** 付けると export した関数が
// そのまま外から呼べる口になる

// ログインを確かめてから、デモインスタンスでは閉じる口 (docs/38-デモモード計画.md §3)。
// UI で出さないことと叩けないことは別の話なので、旗の欠落に頼らず口も閉じる。
// 順はログイン → デモ (未ログインにはデモかどうかより先にログインを求める)。
// アクション本体の先頭で、フォームを読むより前に呼ぶ
export async function requireUserOutsideDemo(demoMessage: string): Promise<void> {
  await requireUser()
  if (isDemoMode()) {
    throw new Error(demoMessage)
  }
}
