// デモの総量クォータの門番 (docs/39-デモ公開計画.md §2)。
//
// 「デモかどうか」の分岐と DB 参照をここに集める。境界の判定そのものは
// demoLimits.ts の純関数 (exceedsUploadQuota / exceedsItemQuota) が持ち、
// 合計・件数を DB から取るのがこの層の役目。route / items は結果を使うだけ。

import 'server-only'
import { isDemoMode } from './appEnv'
import { prisma } from './db'
import { exceedsItemQuota, exceedsUploadQuota } from './demoLimits'
import { totalAttachmentBytes } from './imageStore'

export interface QuotaRejection {
  status: number
  error: string
}

// アップロード総量 (docs/39 §2-1)。デモのときだけ、これから足す incomingBytes を
// 含めて images の総バイト数が上限を超えるなら 507 を返す。デモでない・余裕が
// あるなら null。厳密な直列化はしない (並行で多少はみ出しても再シードで消える)。
export async function checkDemoUploadQuota(
  incomingBytes: number,
): Promise<QuotaRejection | null> {
  if (!isDemoMode()) {
    return null
  }
  const total = await totalAttachmentBytes()
  if (exceedsUploadQuota(total, incomingBytes)) {
    return {
      status: 507,
      error: 'デモの保存容量がいっぱいです。定期リセットをお待ちください',
    }
  }
  return null
}

// ノート数 (docs/39 §2-2)。デモのときだけ、**新規作成になる場合のみ**上限を見る。
// 既存ノートの更新は数に依らず通す (使い勝手を殺さない)。上限に達していれば投げる
// — 呼ぶのは Server Action 経由の upsert なので、投げれば保存が中止される。
export async function assertDemoItemQuota(itemNo: string): Promise<void> {
  if (!isDemoMode()) {
    return
  }
  const existing = await prisma.item.findUnique({
    where: { itemNo },
    select: { itemNo: true },
  })
  if (existing) {
    return
  }
  const count = await prisma.item.count()
  if (exceedsItemQuota(count)) {
    throw new Error('デモのノート数が上限に達しました。定期リセットをお待ちください')
  }
}
