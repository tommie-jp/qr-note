import { cookies } from "next/headers";
import { Suspense } from "react";
import { BusyNotice } from "@/components/BusyNotice";
import { FolderPane } from "@/components/FolderPane";
import { PageTransition } from "@/components/PageTransition";
import PullToRefresh from "@/components/PullToRefresh";
import { SearchForm } from "@/components/SearchForm";
import { SearchTools } from "@/components/SearchTools";
import { SearchNavProvider } from "@/components/SearchNav";
import { SelectModeProvider } from "@/components/SelectModeProvider";
import { isDemoMode } from "@/lib/appEnv";
import { listTags } from "@/lib/items/read";
import { showsFolderPane } from "@/lib/prefs/paneMode";
import { readSearchPrefs } from "@/lib/prefs/searchPrefs";
import { requireUser } from "@/lib/auth/session";
import { qrStickerHost } from "@/lib/site";
import { HomeResults } from "./HomeResults";
import { SearchFolders } from "./SearchFolders";

export const dynamic = "force-dynamic";

interface HomeProps {
  searchParams: Promise<{ q?: string; page?: string; sort?: string }>;
}

export default async function Home({ searchParams }: HomeProps) {
  // 二重目の門番 (docs/18 §4)。proxy.ts も未ログインの画面 GET を止めるが、
  // それは楽観的な検査であって唯一の砦にはしない (settings 系と同じ判断)。
  // proxy を通らずにここへ来る道もある — proxy が素通しする /item/<番号> への
  // 横取り遷移では (search)/default.tsx が children を描く。未ログインの
  // ときは default.tsx 側で一覧ごと伏せる (ログイン案内を残すため) ので、
  // ここで投げるのは default を経ない想定外の道だけ。
  //
  // **置き場所は Home の冒頭**。固定部のタグ補完 (listTags) から DB に触るので、
  // それより前でなければ意味がない。Suspense の後送りは崩れない — Home は
  // もともと listTags を待ってから返すので、待つものが 1 つ前に増えるだけで、
  // HomeResults / SearchFolders は相変わらず後から流れる。currentUser は
  // cache() 済みなので、layout や下の枝が呼んでも照合は 1 回に畳まれる
  await requireUser();
  const { q = "", page = "1", sort: sortParam } = await searchParams;
  const query = q.trim();
  // 並び順 (URL → cookie → 既定)・表示モード・ペイン構成 (フォルダーを出すか、
  // 先頭のノートを自動で選ぶか) を cookie から読む。規則と理由は lib/prefs/searchPrefs.ts
  const { sort, view, paneMode } = readSearchPrefs(await cookies(), sortParam);
  // 検索窓のタグ補完だけは固定部と一緒に引く (小さな表 1 つで速い)。
  // 重い検索本体は HomeResults に隔離して Suspense で後から流す —
  // ログイン直後や直リンクの初回表示で、固定部 (検索窓) を先に出すため
  const tags = await listTags();

  return (
    // 検索窓と結果をまとめて包み、打つそばからの URL 書き換えと待ち状態を
    // 共有する (docs/11-アプリ的UIUX計画.md §3)。
    // 以前ここにあった key={query} は外した。1 文字ごとの書き換えで
    // 作り直されるとフォーカスもキャレットも飛んでしまうため。外からの遷移
    // (スキャン・タグリンク) での窓の追従は SearchForm 側で面倒を見る。
    // stickerHost … シールに焼かれたホストは QR_BASE_URL 固定で、
    // アプリを開いているホスト (localhost 等) とは食い違いうる
    <SearchNavProvider sort={sort}>
      {/* 一覧の先頭で下へ引くと再読み込み (docs/47-引っ張って更新計画.md)。
          window スクロールに対して働くので、包む必要はなく 1 つ置くだけ */}
      <PullToRefresh />
      {/* 選択モードは下部バーの「選択」と一覧 (ItemList) で共有する
          (docs/31-下部操作バー計画.md §5-2)。両方を包める位置がここしかない */}
      <SelectModeProvider>
        <PageTransition>
          {/* 縦の間隔は詰める。検索窓・件数・一覧は 1 つの操作面として続けて
              読む物で、離すほど 1 画面に入る件数が減る。
              data-results-pane … 3 ペインの「ペイン 2」の中身
              (docs/86 §4-3)。器 (main) がペインの領域いっぱいに広がって
              自分でスクロールする。
              data-panes … 選ばれている構成 (§4-9)。globals.css が
              「3 なら幅に関係なくペインの積み方」を決めるのに使う */}
          <div data-results-pane data-panes={paneMode} className="space-y-2">
            {/* スキャン・画像検索は窓の左 (docs/86 §4-15)。**下部バーを
                畳んだ** — 表示・並び順・選択が見出し行へ抜けた後 (§4-11)、
                帯に残るのはこの 2 つだけで、そのために画面の下端を 49px
                使い続けていた。どちらも「検索語の代わりにカメラで探す」
                入口なので、検索窓の隣が本来の居場所になる。
                結果を待たずに出せる点も変わらない (Suspense の外側) */}
            <SearchForm
              initialQuery={query}
              tags={tags.map((t) => t.tag)}
              isDemo={isDemoMode()}
              leading={<SearchTools stickerHost={qrStickerHost()} />}
            />

            {/* 検索本体は Suspense で後送り。初回のドキュメント読み込み
                (ログイン直後など) は固定部が先に出て、結果は届き次第差し替わる。
                クライアント遷移 (打鍵での URL 書き換え・ページ送り) では
                このフォールバックは出ない (App Router は表示済みの内容を保つ)
                ので、既存の PendingLink のスピナーはそのまま生きる */}
            <Suspense
              fallback={
                <BusyNotice role="status" busy>
                  検索結果を読み込み中…
                </BusyNotice>
              }
            >
              <HomeResults
                query={query}
                page={page}
                sort={sort}
                view={view}
                paneMode={paneMode}
              />
            </Suspense>
          </div>

          {/* 検索フォルダー (docs/86 §5)。xl 以上の固定サイドバーで、
              フォルダーはすべて既存の検索・並び順へのリンク。件数と登録
              パターンは DB を引くので Suspense で後送りするが、**fallback は
              null にせずタグだけのペインを出す** — ペインの有無で一覧の幅が
              変わる (globals.css の body:has) ので、後から現れると表示済みの
              カードが横へ跳ねる */}
          {showsFolderPane(paneMode) && (
            <Suspense
              fallback={<FolderPane tags={tags} query={query} sort={sort} />}
            >
              <SearchFolders tags={tags} query={query} sort={sort} />
            </Suspense>
          )}
        </PageTransition>
      </SelectModeProvider>
    </SearchNavProvider>
  );
}
