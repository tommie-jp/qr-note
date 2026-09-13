// 新規ノートの採番 (設計は docs/10-スキャン新規登録計画.md §4)。
//
// items/read.ts ではなくここに置くのは、read.ts が db.ts 経由で DATABASE_URL を
// 要求するため。純関数として切り出せばテストできる。

// 採番の下限。実データで 1000 未満は 1 / 4 / 5 / 6 / 100 の 5 件だけで、
// 実質の運用は 1000 番台から始まっている。そこを埋めにいくと既存の番号帯から
// 外れるので触らない。
export const MIN_ITEM_NO = 1000

// 昇順に並んだ使用中の番号から、min 以上で最初の未使用番号を返す。
//
// max + 1 ではなく欠番を埋める。番号はシールに印刷して部品に貼るものなので
// 短いほど扱いやすく、実データは 511 件が 1〜6000 に散らばっていて隙間が多い。
//
// 「未使用の番号を再利用してよいのは、このアプリにノートの削除機能が無く
// 『未使用 = 一度も使われていない』が成立しているから」。削除を入れるときは
// 古いシールが別の部品を指しうるので、この前提を見直すこと。
export function firstUnusedNo(usedAsc: number[], min: number): number {
  let candidate = min
  for (const used of usedAsc) {
    if (used > candidate) {
      break // 隙間に当たった
    }
    if (used === candidate) {
      candidate++
    }
    // used < candidate は下限より小さい番号か重複 (itemNo "1000" と "01000" は
    // どちらも item_no_num=1000 になりうる)。どちらも読み飛ばす
  }
  return candidate
}
