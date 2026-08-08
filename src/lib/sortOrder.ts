// 一覧の並び順 → ORDER BY 句 (DB 非依存の純関数)。
//
// items.ts ではなくここに置くのは、items.ts が db.ts 経由で DATABASE_URL を
// 要求するため。純関数として切り出せばテストできる (itemNo.ts と同じ理由)。
//
// 並びの設計 (docs/37-アクセス順計画.md):
//   番号順      … シールに印刷した番号を辿るとき
//   更新順      … 既定。書いた順に積み上がる
//   アクセス順  … 最近見た順。ENEX から取り込んだノートは作成・更新日時が
//                 Evernote 由来 (2012 年など) で更新順では埋もれるため
//   タイトル順  … 名前で引くとき (docs/63-タイトル順計画.md)。日時を覚えて
//                 いなくても、見出しの頭文字から辿り着ける

import type { Sort } from './validation'

// **どの並びも item_no で決着させる**のが要点。同時刻の行 (インポート直後など)
// で並びが不定になると、ページ送りと前後ナビが読み込みのたびに揺れる
// (docs/15 §2-2)。
//
// 戻り値は**この関数が持つ定数のみ**。呼び出し側は Prisma.raw に通すので、
// 引数の文字列がそのまま SQL に混ざらないことをここで保証する
// (switch を素通りした値は既定へ倒す)。
// 逆順 (docs/64-並び順逆順計画.md) は**並べる鍵の向きだけ**を裏返す。
// 末尾のタイブレーク (item_no ASC) はどちらの向きでも同じにする — ここは
// 「同着をいつも同じ順で解く」ための鍵で、見せたい並びの一部ではない。
//
// NULLS LAST も裏返さない。番号として読めない itemNo と見出しの無いノートは、
// どちらの向きでも末尾に置く。方向を変えたとたんに読めない行が先頭を
// 埋めるのでは、逆順にした意味 (端から辿る) が消える。
export function orderByClause(sort: Sort): string {
  switch (sort) {
    case 'itemNo':
      // 非数字の itemNo は item_no_num が null なので末尾へ回す
      return 'item_no_num ASC NULLS LAST, item_no ASC'
    case 'itemNoDesc':
      return 'item_no_num DESC NULLS LAST, item_no ASC'
    case 'accessed':
      // 見ていないノートが同着になったときは更新順で解く
      return 'accessed_at DESC, updated_at DESC, item_no ASC'
    case 'accessedAsc':
      // 長く見ていない順。同着は更新順も揃えて古い方を先に出す
      return 'accessed_at ASC, updated_at ASC, item_no ASC'
    case 'titleDesc':
      return "NULLIF(CASE WHEN mode = 'url' THEN url ELSE title END, '') DESC NULLS LAST, item_no ASC"
    case 'updatedAsc':
      return 'updated_at ASC, item_no ASC'
    case 'title':
      // 並べる鍵は**一覧に出ている見出しそのもの**にする。URL モードの行だけ
      // 見出しが url なのは ItemRow.tsx と同じ切り分けで、ここを揃えないと
      // 「画面の並びと違う順」になる (title 列は memo 由来なので url を知らない)。
      //
      // 見出しの無いノート (空メモ・画像だけ) は '' になる。空文字は照合順序上
      // 先頭に来てしまい、名前で引きたいときに邪魔なので NULLIF で末尾へ回す
      // (番号順が非数字を末尾へ回すのと同じ考え方)。
      return "NULLIF(CASE WHEN mode = 'url' THEN url ELSE title END, '') ASC NULLS LAST, item_no ASC"
    default:
      return 'updated_at DESC, item_no ASC'
  }
}
