// git 履歴の書き込み (docs/57)。もとは app/actions/history.ts の中身
import 'server-only'
import type { Item } from '@/generated/prisma/client'
import { isValidCommitOid } from '@/lib/git/notePath'
import { backfillAllNotes } from '@/lib/git/noteHistoryBackfill'
import { commitNote, noteAtCommit, noteHistory } from '@/lib/git/notesRepo'
import { getItem } from '@/lib/items/read'
import { upsertMemo } from '@/lib/items/write'
import { checkpointBeforeOverwrite } from './checkpoint'
import { CommandError } from './commandError'

// 版に名前を付けて刻む。1 行目だけを使い、制御文字は落とす
export async function commitNoteVersion(
  itemId: string,
  rawMessage: string,
): Promise<'committed' | 'noop'> {
  const message =
    rawMessage
      .split('\n')[0]
      ?.replace(/[\x00-\x1f\x7f]/g, '')
      .trim() || `update ${itemId}`
  const item = await getItem(itemId)
  if (item === null) {
    throw new CommandError(404, 'ノートが見つかりません')
  }
  const oid = await commitNote(itemId, item.memo, message)
  return oid === null ? 'noop' : 'committed'
}

// 過去の版を今の本文に戻す。戻す前に今の本文を 1 版刻む (刻めなければ戻さない)
export async function restoreNoteVersion(itemId: string, oid: string): Promise<Item> {
  if (!isValidCommitOid(oid)) {
    throw new CommandError(400, 'コミット oid が不正です')
  }
  const history = await noteHistory(itemId)
  if (!history.some((commit) => commit.oid === oid)) {
    throw new CommandError(404, 'このノートの履歴にないコミットです')
  }
  const memo = await noteAtCommit(itemId, oid)
  if (memo === null) {
    throw new CommandError(404, 'この版にノートの本文がありません')
  }
  if (!(await checkpointBeforeOverwrite(itemId, memo))) {
    throw new CommandError(500, 'いまの本文を履歴に残せませんでした。復元していません')
  }
  return upsertMemo(itemId, memo)
}

export async function backfillHistory(): Promise<'imported' | 'noop'> {
  const { oid } = await backfillAllNotes()
  return oid === null ? 'noop' : 'imported'
}
