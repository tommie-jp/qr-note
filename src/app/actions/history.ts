'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { readItemNo, readText } from '@/lib/actionForm'
import { isValidCommitOid } from '@/lib/git/notePath'
import { commitNote, noteAtCommit, noteHistory } from '@/lib/git/notesRepo'
import { getItem } from '@/lib/items/read'
import { upsertMemo } from '@/lib/items/write'
import { backfillAllNotes } from '@/lib/noteHistoryBackfill'
import { requireUserOutsideDemo } from './_guards'
import { revalidateItem } from './_revalidate'
import { checkpointBeforeOverwrite, savedHref } from './_save'

// --- git 履歴 (docs/57-ノートgit履歴計画.md) ---

// デモモードでは履歴機能を丸ごと閉じる (docs/57 §4)。毎時再シードで履歴が
// 嘘になるうえ、ゲストの書き込みで履歴が溜まる一方になる。UI はリンクごと
// 出さないが、Server Action は画面を通さず叩ける口なのでここでも塞ぐ
// (setItemPublicAction と同じ二重防御)。
const DEMO_HISTORY_MESSAGE = 'デモモードでは履歴機能は使えません'

// いまの本文を 1 版としてコミットする。
//
// **本文はフォームから受けず、DB のいまの memo をコミットする**のが要点。
// 編集画面は自動保存込みで DB が常に最新であり、画面由来の本文を受けると
// 「保存していない本文がコミットだけされる」というねじれが作れてしまう。
export async function commitNoteAction(formData: FormData): Promise<void> {
  await requireUserOutsideDemo(DEMO_HISTORY_MESSAGE)
  const itemNo = readItemNo(formData)
  // メッセージは 1 行目だけ使う (git の subject。履歴一覧に出るのはここ)。
  // 制御文字も除く — アプリ内表示は React が守るが、bundle を手元の端末で
  // `git log` したときの表示崩れ/エスケープ注入をここで断つ。
  // 未入力は既定文言 — 空メッセージでコミットを止めるほどの操作ではない
  const message =
    readText(formData, 'message')
      .split('\n')[0]
      ?.replace(/[\x00-\x1f\x7f]/g, '')
      .trim() || `update ${itemNo}`

  const item = await getItem(itemNo)
  if (item === null) {
    throw new Error('ノートが見つかりません')
  }
  const oid = await commitNote(itemNo, item.memo, message)
  revalidatePath(`/item/${itemNo}/history`)
  // 「コミットした」と「変化なし (null)」を画面で見分けられるようにする
  // (backfillHistoryAction と同じ ?done= の流儀)。変化なしは、画面の描画と
  // 送信の間に別タブが同じ内容を先にコミットしたときに起こる — その場合
  // 入力したメッセージは使われないので、成功と同じ顔をさせない
  redirect(
    `/item/${itemNo}/history?done=${oid === null ? 'noop' : 'committed'}`,
  )
}

// 過去の版の本文へ戻す。
//
// git 側は触らず、**既存の保存経路 (upsertMemo) で DB だけを書き換える** —
// tags / props / taskTodo の派生キャッシュを再計算させるため (docs/57 §4)。
// 結果は「未コミットの変更がある」状態になり、気に入らなければコミットせずに
// 直せるし、確定なら次のコミットが「復元した」という 1 版になる。
// 永久削除済みのノートも upsert なので蘇る (履歴からの回収口)。
export async function restoreNoteVersionAction(formData: FormData): Promise<void> {
  await requireUserOutsideDemo(DEMO_HISTORY_MESSAGE)
  const itemNo = readItemNo(formData)
  const oid = String(formData.get('oid') ?? '')
  if (!isValidCommitOid(oid)) {
    throw new Error('コミット oid が不正です')
  }
  // このノートの履歴に載っている oid だけを受ける ([oid]/page.tsx と同じ約束)。
  // showNote はパスを notes/<itemNo>.md に固定するので他ノートの本文は
  // 漏れないが、履歴と無関係なコミットからの「復元」を意味として許さない
  const history = await noteHistory(itemNo)
  if (!history.some((commit) => commit.oid === oid)) {
    throw new Error('このノートの履歴にないコミットです')
  }

  const memo = await noteAtCommit(itemNo, oid)
  if (memo === null) {
    throw new Error('この版にノートの本文がありません')
  }
  // 復元は「いま DB にある本文」を失う操作。未コミットのまま消える版が
  // 出ないよう、先に 1 版刻む (docs/87 §4)。刻めなければ復元しない
  if (!(await checkpointBeforeOverwrite(itemNo, memo))) {
    throw new Error('いまの本文を履歴に残せませんでした。復元していません')
  }
  await upsertMemo(itemNo, memo)
  revalidateItem(itemNo)
  redirect(savedHref(itemNo))
}

// 既存ノートの一括取り込み (docs/57 §6)。設定ページ (/settings/history) の
// ボタンから。冪等なので二重送信されても余分なコミットは増えない。
export async function backfillHistoryAction(): Promise<void> {
  await requireUserOutsideDemo(DEMO_HISTORY_MESSAGE)
  const { oid } = await backfillAllNotes()
  redirect(`/settings/history?done=${oid === null ? 'noop' : 'imported'}`)
}
