// 一覧の並び順 → ORDER BY 句 (DB 非依存の純関数)。
//
// items/ ではなくここに置くのは、items/ のクエリ側 (read.ts など) が db.ts
// 経由で DATABASE_URL を要求するため。純関数として切り出せばテストできる
// (items/itemId.ts と同じ理由)。
//
// 並びの設計 (docs/37-アクセス順計画.md):
//   登録順      … 作った順 (移行前のノートは旧番号順。docs/107 §4-6)
//   更新順      … 既定。書いた順に積み上がる
//   アクセス順  … 最近見た順。ENEX から取り込んだノートは作成・更新日時が
//                 Evernote 由来 (2012 年など) で更新順では埋もれるため
//   タイトル順  … 名前で引くとき (docs/63-タイトル順計画.md)。日時を覚えて
//                 いなくても、見出しの頭文字から辿り着ける
//   削除順      … ゴミ箱だけの並び (docs/67-ゴミ箱表示形式計画.md)。あちらの
//                 既定。検索一覧では deleted_at が必ず null なので出てこない

import type { TrashSort } from '../validation'

// **どの並びも id で決着させる**のが要点。同時刻の行 (インポート直後など)
// で並びが不定になると、ページ送りと前後ナビが読み込みのたびに揺れる
// (docs/15 §2-2)。
//
// 戻り値は**この関数が持つ定数のみ**。呼び出し側は Prisma.raw に通すので、
// 引数の文字列がそのまま SQL に混ざらないことをここで保証する
// (switch を素通りした値は既定へ倒す)。
// 逆順 (docs/64-並び順逆順計画.md) は**並べる鍵の向きだけ**を裏返す。
// 末尾のタイブレーク (id ASC) はどちらの向きでも同じにする — ここは
// 「同着をいつも同じ順で解く」ための鍵で、見せたい並びの一部ではない。
//
// NULLS LAST も裏返さない。見出しの無いノートは、どちらの向きでも末尾に置く。
// 方向を変えたとたんに読めない行が先頭を埋めるのでは、逆順にした意味
// (端から辿る) が消える。
export function orderByClause(sort: TrashSort): string {
  switch (sort) {
    case 'deleted':
      // ゴミ箱の既定。消したばかりの物が上 (「いま消したあれ」を戻すのが
      // ゴミ箱を開く最大の動機)
      return 'deleted_at DESC, id ASC'
    case 'deletedAsc':
      // 長く置いてある順。永久削除の候補を端から片付けるとき
      return 'deleted_at ASC, id ASC'
    case 'registered':
      // id は UUID v7 で先頭が時刻なので、id 順 = 作った順 (docs/107 §4-6)。
      // 移行前のノートは旧番号の昇順で振ってあり、いままでの番号順と同じに見える
      return 'id ASC'
    case 'registeredDesc':
      return 'id DESC'
    case 'accessed':
      // 見ていないノートが同着になったときは更新順で解く
      return 'accessed_at DESC, updated_at DESC, id ASC'
    case 'accessedAsc':
      // 長く見ていない順。同着は更新順も揃えて古い方を先に出す
      return 'accessed_at ASC, updated_at ASC, id ASC'
    case 'titleDesc':
      return "NULLIF(title, '') DESC NULLS LAST, id ASC"
    case 'updatedAsc':
      return 'updated_at ASC, id ASC'
    case 'title':
      // 並べる鍵は**一覧に出ている見出しそのもの** (title = memo 由来の派生列。
      // items/itemRowDecor.ts の rowTitle と同じ物) にする。
      //
      // 見出しの無いノート (空メモ・画像だけ) は '' になる。空文字は照合順序上
      // 先頭に来てしまい、名前で引きたいときに邪魔なので NULLIF で末尾へ回す
      return "NULLIF(title, '') ASC NULLS LAST, id ASC"
    default:
      return 'updated_at DESC, id ASC'
  }
}
