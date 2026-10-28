import { FolderPane } from "@/components/search/FolderPane";
import { countFolderTotals, type TagCount } from "@/lib/items/read";
import { countTrashedItemsOnce } from "@/lib/search/pageData";
import { listQueries } from "@/lib/search/queryStore";
import { currentUser } from "@/lib/auth/session";
import { startPhases } from "@/lib/logging/phase";
import { reportServerLine } from "@/lib/logging/perfServer";
import { isPerfLogEnabled } from "@/lib/logging/perfSwitch";
import type { Sort } from "@/lib/validation";

// 検索フォルダーの件数を引いて描く (docs/86 §5)。HomeResults と同じ
// 「重い部分を隔離して後から流す」作り。タグ一覧は Home が補完用に
// 引いたものを使い回す (同じ表を二度引かない)
export async function SearchFolders({
  tags,
  query,
  sort,
}: {
  tags: TagCount[];
  query: string;
  sort: Sort;
}) {
  // ☆ 登録パターン (docs/59 §7) はユーザーごと。この画面は門番 (proxy と
  // Home 冒頭の requireUser) の内側だが、万一の未ログインは空で受ける
  // (ペインの他の節は個人情報でない)
  const t = startPhases(isPerfLogEnabled());
  const user = await currentUser();
  const [totals, trashCount, queryLists] = await Promise.all([
    t.time("集計", () => countFolderTotals()),
    t.time("ゴミ箱", () => countTrashedItemsOnce()),
    user
      ? t.time("登録", () => listQueries(user))
      : Promise.resolve({ saved: [], recent: [] }),
  ]);
  // フォルダーペイン (3 ペイン) の段階 (docs/119 §2-1)。タグの件数も残す —
  // docs/118 §1 で絞った効き目をこの数で見る
  reportServerLine("検索/フォルダー", [["タグ", tags.length]], t.done());
  return (
    <FolderPane
      tags={tags}
      totals={totals}
      trashCount={trashCount}
      saved={queryLists.saved}
      query={query}
      sort={sort}
    />
  );
}
