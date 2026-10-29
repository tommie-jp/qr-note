import { cookies } from "next/headers";
import { FolderPaneGate, ResultsPaneRoot } from "@/components/panes/PaneModeProvider";
import { PageTransition } from "@/components/chrome/PageTransition";
import PullToRefresh from "@/components/chrome/PullToRefresh";
import { FolderPaneClient } from "@/components/search/FolderPaneClient";
import { SearchFormClient } from "@/components/search/SearchFormClient";
import { SearchResultsClient } from "@/components/search/SearchResultsClient";
import { SearchTools } from "@/components/search/SearchTools";
import { SearchNavProvider } from "@/components/search/SearchNav";
import { SelectModeProvider } from "@/components/search/SelectModeProvider";
import { paneBgClass } from "@/components/item/ItemDetail";
import { isDemoMode } from "@/lib/appEnv";
import { requireUser } from "@/lib/auth/session";
import { showsFolderPane } from "@/lib/prefs/paneMode";
import { readSearchPrefs } from "@/lib/prefs/searchPrefs";
import { SORT_COOKIE } from "@/lib/prefs/sortMode";
import { qrStickerHost } from "@/lib/site";
import { parseSort } from "@/lib/validation";

export const dynamic = "force-dynamic";

// 検索画面の殻 (docs/123 §4-2)。**ここでは DB を引かない。**
//
// サーバ描画の頃は検索・タグ・フォルダーの集計をここで引き、結果を RSC で
// 運んでいた。今は検索窓・一覧・フォルダーとも端末が JSON API から引いて描く
// (SearchFormClient・SearchResultsClient・FolderPaneClient)。殻が受け持つのは
//
//   - 門番 (requireUser)。proxy.ts の楽観的な検査の二重目 (docs/18 §4)
//   - cookie の好み (並び順・表示モード・ペイン構成) を初回描画に間に合わせる
//   - env (デモか・本番か) を端末へ渡す
//
// だけになった。検索語は URL (useSearchParams) から端末が読むので、この殻は
// 検索語が変わっても描き直されない (URL の書き換えは history.replaceState)
export default async function Home() {
  await requireUser();
  const cookieStore = await cookies();
  // 並び順・表示モード・ペイン構成。規則と理由は lib/prefs/searchPrefs.ts。
  // 並び順は URL も見るが、URL は端末が読むので、ここは cookie の値だけを渡す
  const { view, paneMode } = readSearchPrefs(cookieStore, undefined);
  const cookieSort = parseSort(cookieStore.get(SORT_COOKIE)?.value);

  return (
    <SearchNavProvider sort={cookieSort}>
      {/* 一覧の先頭で下へ引くと再読み込み (docs/47) */}
      <PullToRefresh />
      {/* 選択モードは一覧 (ItemList) とツールバーで共有する (docs/31 §5-2) */}
      <SelectModeProvider>
        <PageTransition>
          <ResultsPaneRoot>
            <SearchFormClient
              cookieSort={cookieSort}
              isDemo={isDemoMode()}
              leading={<SearchTools stickerHost={qrStickerHost()} />}
            />
            <SearchResultsClient
              cookieSort={cookieSort}
              serverView={view}
              paneBgClass={paneBgClass()}
              isDemo={isDemoMode()}
            />
          </ResultsPaneRoot>
          {/* 検索フォルダー (docs/86 §5)。xl 以上の固定サイドバー */}
          {showsFolderPane(paneMode) && (
            <FolderPaneGate>
              <FolderPaneClient cookieSort={cookieSort} />
            </FolderPaneGate>
          )}
        </PageTransition>
      </SelectModeProvider>
    </SearchNavProvider>
  );
}
