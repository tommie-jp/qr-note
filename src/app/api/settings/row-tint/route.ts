import { NextResponse } from 'next/server'
import { denyCrossSite, denyIfDemoMode, denyUnlessLoggedIn } from '@/lib/apiAuth'
import { apiFail, apiOk, readJsonObject } from '@/lib/authApi'
import { isRowTintId } from '@/lib/rowTint'
import { saveRowTintId } from '@/lib/rowTintStore'
import { currentUser } from '@/lib/session'

// 検索結果で選択中の行の地色を保存する口 (docs/88-選択行の色計画.md)。
//
// PUT だけ。読み出しの口は要らない — 色はサーバが layout で読んで html の
// CSS 変数として配るので、クライアントが自分で引きにいく場面がない。
//
// **サーバアクションにしない。** アクションから呼ぶとその場のページが
// 描き直されるが、色はもう DOM の変数を書き換えて当ててあるので、描き直しは
// 純粋な無駄 (一覧を開いていれば数十行を組み直す)。
//
// **デモでは断る** (docs/38-デモモード計画.md §4)。デモは共有アカウントなので、
// 誰か 1 人が色を変えると同時に見ている全員の一覧の色が変わる。導線 (メニューの
// 行) 自体も layout が出さないが、口の側でも塞ぐ — 旗の欠落や導線の隠蔽に
// 頼らない (§2「欠落は無防備へ倒れる」)。
export async function PUT(request: Request): Promise<NextResponse> {
  const denied =
    denyIfDemoMode() ?? (await denyUnlessLoggedIn()) ?? denyCrossSite(request)
  if (denied) {
    return denied
  }

  const userName = await currentUser()
  if (userName === null) {
    // denyUnlessLoggedIn を通った後なのでここへは来ない。素通しにせず断る
    return apiFail('ログインが必要です', 401)
  }

  // **知らない色は畳まず断る。** parseRowTintId で既定へ寄せると、送り手は
  // 保存できたと思い込んだまま次の読み込みで青に戻る
  const tint = (await readJsonObject(request))?.tint
  if (!isRowTintId(tint)) {
    return apiFail('リクエストの形式が正しくありません', 400)
  }

  await saveRowTintId(userName, tint)
  return apiOk({ tint })
}
