// 保存の「基点」— 画面がいま見ている版を表す文字列
// (docs/87-編集競合対策計画.md §2-1)。
//
// 保存は「基点が同じなら書く」条件付き UPDATE (items.ts の
// saveItemIfUnchanged) で、この文字列がフォームに乗って往復する。
// **版番号には items.updated_at を流用する** — この列が動くのは本文系の
// 書き込みだけで (公開・ゴミ箱・アクセス日時は生 SQL で避けている)、
// ちょうど版の性質を満たすため。列を足せば migrate が要り、それは
// PGroonga の索引を落とす (docs/87 §1-1)。
//
// ここは DB を知らない純関数だけを持つ (テスト容易性)。

// まだ行が無い前提 = これから作る
export const BASE_NEW = 'new'
// 基点が判らない (旧形式の下書きから復元した本文)。**必ず競合扱いにする**
// 印で、いまの版を当ててしまうと「古い本文 + 新しい基点」で黙って
// 上書きできてしまう (docs/87 §2-6)
export const BASE_STALE = 'stale'

export type SaveBase =
  | { kind: 'new' }
  | { kind: 'at'; at: Date }
  | { kind: 'stale' }

// Date が表せる最大ミリ秒。これを超えると Invalid Date になり、
// Prisma の引数検証まで届いて 500 になる
const MAX_TIME_MS = 8.64e15

// ISO 文字列や表示用の日時は使わない — パース差と丸めの温床。
// TIMESTAMP(3) と JS の Date はどちらもミリ秒なので、生の数値が一番素直
export function formatBase(updatedAt: Date | null): string {
  return updatedAt === null ? BASE_NEW : String(updatedAt.getTime())
}

// フォームから来た値を読む。**不正は null = 閉じる側に倒す** (保存しない)。
// 誰でも叩ける POST の口なので、形は自分で確かめる。
//
// Number() に任せず先に数字だけの並びかを見るのが要点 — Number は
// ' 12 ' も '0x10' も '1e400' も黙って数にしてしまう
export function parseBase(raw: unknown): SaveBase | null {
  if (typeof raw !== 'string') {
    return null
  }
  if (raw === BASE_NEW) {
    return { kind: 'new' }
  }
  if (raw === BASE_STALE) {
    return { kind: 'stale' }
  }
  if (!/^\d+$/.test(raw)) {
    return null
  }
  const ms = Number(raw)
  if (!Number.isSafeInteger(ms) || ms > MAX_TIME_MS) {
    return null
  }
  return { kind: 'at', at: new Date(ms) }
}

// 次の版の updated_at。**必ず基点より後**にする。
//
// @updatedAt (Prisma が打つ now()) に任せない — 同じミリ秒に 2 回書くと
// 版が重なり、その隙間で読んだ基点が 2 回目の書き込みを素通りする (ABA)。
// Prisma 7.9.1 は data に明示した値が @updatedAt に勝つ (実測済み)
export function nextVersion(prev: Date, now: number = Date.now()): Date {
  return new Date(Math.max(now, prev.getTime() + 1))
}
