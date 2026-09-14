// ノートを公開として読んでよいかの判定 (docs/22-ノート公開計画.md)。
//
// ここが公開判定の**正本**。ページ (item / print)、route handler (画像配信)、
// テストのすべてがこれを呼ぶ。同じ問いに答える場所が増えると、片方だけ直して
// 穴が開く (auth/publicPaths.ts が「エッジとアプリに散らさない」と言っているのと同じ)。
//
// DB にも next/headers にも触らない純粋な層にする (auth/basicAuth.ts と同じ流儀)。
// 行を取ってくるのは items/read.ts、リクエストと結びつけるのはページの役目。
// (env の参照は純粋な層のまま — appEnv.ts / site.ts と同じ扱い)

import { isDemoMode } from "../appEnv"

// getItem() の返り値 (Item) をそのまま渡せる形にしておく。判定に要る 2 列だけを
// 求めることで、$queryRaw で列を絞った行からも呼べる
export interface PublicCheckable {
  publicAt: Date | null
  deletedAt: Date | null
}

// 未登録 (null) を受けるのは、呼び出し側が getItem() の結果をそのまま渡せるようにするため。
// 「未登録」と「非公開」を同じ false に潰すのは意図的 — 未ログインの人への
// 応答を揃え、連番の itemNo を叩いてノートの存在を数えられないようにする
// (docs/22 §4, §8)。
//
// 返り値を型ガード (item is T) にしてあるので、真の枝では item が非 null に
// 絞られる。呼び出し側が `item!` と書かずに済む = 判定を通さずに中身へ触る
// 書き方のほうが面倒になる、という形にしておきたい。
export function isPublicItem<T extends PublicCheckable>(item: T | null): item is T {
  // デモインスタンスでは公開を一切認めない (docs/38-デモモード計画.md §3)。
  // ここが公開判定の正本なので、未ログイン閲覧の口 (item/print ページ・公開画像の
  // 配信・公開ノート閲覧で起動する TeX 子プロセス) がまとめて閉じる。再シードの
  // 種を本番 dump から作って public_at 付きの行が紛れても、ここ 1 箇所で塞がる。
  if (isDemoMode()) {
    return false
  }

  if (item === null) {
    return false
  }

  // ゴミ箱のノートは公開しない (docs/22 §3)。/item はゴミ箱の行も持ち主には
  // 本文を見せる (docs/12 §5) が、それはシールが貼られたままの部品が出てきた
  // 持ち主のための救済であって、外の人に見せる理由はない。
  // public_at は消さないので、復元すれば公開状態も戻る
  if (item.deletedAt !== null) {
    return false
  }

  return item.publicAt !== null
}
