"use client";

import { useEffect, useState } from "react";
import { toggleSavedLists, type Suggestion } from "@/lib/search/suggest";
import {
  cachedQueries,
  fetchQueries,
  registerSavedQuery,
  unregisterSavedQuery,
} from "@/lib/searchQueryClient";
import { migrateLegacyQueries } from "@/lib/searchQueryLegacy";
import { isSavedFull, type QueryLists } from "@/lib/searchQueries";

// ☆/★ を押した結果。
//
//   unloaded … まだ読めていない。知らない物へ書き戻さない
//   full     … 登録が満杯で入れられなかった
//   toggled  … 切り替えた (lists は楽観更新した後の値)
export type ToggleSavedResult =
  | { status: "unloaded" }
  | { status: "full" }
  | { status: "toggled"; lists: QueryLists };

// 検索窓が出す候補の元 (登録パターンと最近の検索) を持つ
// (docs/59-検索候補計画.md §7)。読み直し・☆ の切り替え・localStorage からの
// 引き取りをここに寄せ、ドロップダウンの開閉 (useSuggestDropdown) とは分ける。
//
// isDemo … デモかどうか。localStorage の引き取りだけが使う (SearchForm の props 参照)
export function useSavedQueries(isDemo: boolean) {
  // サーバから受け取った候補 (docs/59-検索候補計画.md §7)。null = まだ読めて
  // いない。初期値にモジュールのキャッシュを使うことで、一度読んだ後は
  // ページを移っても開いた瞬間に出る (取り直しは並行して走る)
  const [lists, setLists] = useState<QueryLists | null>(() => cachedQueries());

  // 候補をサーバから取り直す (docs/59-検索候補計画.md §7)。
  //
  // **開くたびに引き直す**。最近の検索は結果のノートを開いたときにも記録され
  // (SearchNav)、別の端末からも増えるので、一度読んで持っていると古い。
  // 待たせはしない — 届いたら useSuggestDropdown の同期ブロックが拾う
  const reloadLists = () => {
    void fetchQueries().then((next) => {
      if (next !== null) {
        setLists(next);
      }
    });
  };

  // 移す前の版が localStorage に残した登録パターンを引き取る (一度だけ)。
  // 引き取り終わったら searchQueryLegacy.ts ごと消す。
  // デモは受け取らないので送りもしない (searchQueryLegacy.ts 冒頭)
  useEffect(() => {
    void migrateLegacyQueries(isDemo).then((next) => {
      if (next !== null) {
        setLists(next);
      }
    });
  }, [isDemo]);

  // 候補の行を登録パターンに入れる / 外す (docs/59-検索候補計画.md §4)。
  const toggleSaved = (s: Suggestion): ToggleSavedResult => {
    if (lists === null) {
      return { status: "unloaded" };
    }
    if (s.kind === "recent" && isSavedFull(lists.saved)) {
      // 満杯。☆ は押せなくしてあるが、別の端末で埋まった場合は一覧を組んだ
      // 時点の値がまだ「空きあり」なので押せてしまう。**黙って何も起きない
      // のがいちばん困る** (登録したつもりになる) ので、呼ぶ側が押せない
      // 見た目へ直して理由を出す (☆ の title)
      return { status: "full" };
    }
    const next = toggleSavedLists(lists, s);
    // 楽観更新。★ を押した手応えを往復待ちにしない
    setLists(next);
    void (
      s.kind === "saved"
        ? unregisterSavedQuery(s.value)
        : registerSavedQuery(s.value)
    ).then((server) => {
      // 断られた (満杯・通信断) ときは null。手元の楽観更新は次に開いたときの
      // 読み直しで正本に戻るので、ここで巻き戻して画面を跳ねさせない
      if (server !== null) {
        setLists(server);
      }
    });
    return { status: "toggled", lists: next };
  };

  return { lists, reloadLists, toggleSaved };
}
