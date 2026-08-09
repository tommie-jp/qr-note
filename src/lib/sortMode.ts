// 一覧の並び順を「覚えておく」ための cookie (docs/11-アプリ的UIUX計画.md §3)。
//
// **URL と cookie の二段構え**にする:
//   URL に ?sort= があればそれが正 (共有リンク・ページ送り・戻り先)
//   無ければ cookie (前に自分が選んだ並び)
//   それも無ければ既定 (更新順)
//
// なぜ cookie を足したか — 当初は「並び順は『何を見ているか』だから URL が正」
// と決めて URL だけに置いていた (viewMode.ts の対比コメント)。ところが
// `?sort=` を持たない入口が 4 つあり、そこから入るたびに既定へ戻っていた:
//
//   ヘッダーの「QR search」/ 検索フォームの送信 / スキャン結果 / タグリンク
//
// **これは viewMode.ts が cookie を選んだ理由として挙げていた
// 「スキャンやタグリンクで入るたびに既定へ戻る」そのもの**。並び順、とくに
// アクセス順は「最近見た順で探したい」という持続する好みなので、
// 表示モードと同じく覚えているのが期待どおり。
//
// URL を捨てて cookie 一本にはしない。ページ送りと一覧への戻りは
// 「いま見ている並びのまま」でなければならず、そこは URL が正でよい。
//
// cookie ならサーバコンポーネントが描画前に読めるので、初回描画から正しい
// 並びで出る (localStorage だと一度描いてから跳ねる)。

import { parseSort, parseTrashSort, type Sort, type TrashSort } from './validation'

export const SORT_COOKIE = 'sort'

// ゴミ箱の並びは別の cookie に持つ (docs/67-ゴミ箱表示形式計画.md §2)。
//
// **検索一覧と共有しない。** ゴミ箱の既定は削除順で、その値は検索側では
// 意味を持たない (deleted_at が必ず null)。1 つの cookie にすると、ゴミ箱で
// 削除順を選んだ後に検索へ戻ったとき、知らない値として既定へ倒れる —
// つまり検索の並びがゴミ箱を開くたびに巻き戻る。逆に検索で選んだ並びが
// ゴミ箱の既定 (削除順) を上書きするのも期待と違う。
//
// 一方 URL の `?sort=` はパスで分かれる (`/` と `/trash`) ので分ける必要がない。
export const TRASH_SORT_COOKIE = 'trashSort'

// 好みなので、次に自分で変えるまで続く (viewMode と揃えて 1 年)
export const SORT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

// URL → cookie → 既定 の順に見て並び順を決める。
//
// どちらも利用者が自由に書き換えられる外部入力なので、parseSort で畳んでから
// 使う (知らない値は既定へ倒れる)。
//
// urlSort が undefined/null のときだけ cookie を見るのが要点。URL に
// 明示があるなら、それが cookie と違っていても URL を優先する
// (共有されたリンクを開いた人に、自分の好みを混ぜて見せない)。
export function resolveSort(urlSort: unknown, cookieSort: unknown): Sort {
  if (urlSort !== undefined && urlSort !== null) {
    return parseSort(urlSort)
  }
  return parseSort(cookieSort)
}

// ゴミ箱側も同じ二段構え。/trash への入口 (検索結果の「ゴミ箱 (N)」リンク・
// 0 件案内・ノートのバナー) はどれも `?sort=` を持たないので、cookie が
// 無いと開くたびに既定へ戻る — 検索側で cookie を足した理由そのもの。
export function resolveTrashSort(
  urlSort: unknown,
  cookieSort: unknown,
): TrashSort {
  if (urlSort !== undefined && urlSort !== null) {
    return parseTrashSort(urlSort)
  }
  return parseTrashSort(cookieSort)
}
