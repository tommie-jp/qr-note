import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import {
  bulkTagAction,
  setSortAction,
  setViewModeAction,
  trashItemsAction,
} from "@/app/actions";
import { AutoLoadMore } from "@/components/AutoLoadMore";
import { BottomActionBar } from "@/components/BottomActionBar";
import { ItemList } from "@/components/ItemList";
import { PageTransition } from "@/components/PageTransition";
import { PropsTable } from "@/components/PropsTable";
import PullToRefresh from "@/components/PullToRefresh";
import { SearchForm } from "@/components/SearchForm";
import { SearchNavProvider, SearchResults } from "@/components/SearchNav";
import { SelectModeProvider } from "@/components/SelectModeProvider";
import { TaskProgress } from "@/components/TaskProgress";
import {
  BUSY_NOTICE_CLASS,
  BUSY_SPINNER_CLASS,
  WIDE_RESULTS_CLASS,
} from "@/components/ui";
import { isDemoMode, isProductionEnv } from "@/lib/appEnv";
import {
  countTaskProgress,
  countTrashedItems,
  countTrashedMatches,
  listTags,
  nextItemNo,
  searchItemProps,
  searchItems,
} from "@/lib/items";
import { isTaggableCode, scanRegisterHref } from "@/lib/scanRegister";
import { queryHasTagTerm, queryTracksTaskProgress } from "@/lib/search";
import { buildSearchUrl } from "@/lib/searchUrl";
import { qrStickerHost } from "@/lib/site";
import { SORT_COOKIE, resolveSort } from "@/lib/sortMode";
import type { Sort } from "@/lib/validation";
import { parseViewMode, VIEW_MODE_COOKIE } from "@/lib/viewMode";

export const dynamic = "force-dynamic";

interface HomeProps {
  searchParams: Promise<{ q?: string; page?: string; sort?: string }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const { q = "", page = "1", sort: sortParam } = await searchParams;
  const query = q.trim();
  const cookieStore = await cookies();
  // 並び順は URL → cookie → 既定 の順に決める (src/lib/sortMode.ts)。
  // URL だけを見ていた頃は、?sort= を持たない入口 (ヘッダーのホーム・
  // 検索フォーム・スキャン・タグリンク) から入るたびに既定へ戻っていた
  const sort = resolveSort(sortParam, cookieStore.get(SORT_COOKIE)?.value);
  // 表示モードは検索状態ではなく端末ごとの好みなので URL ではなく cookie。
  // ここ (サーバ) で読めるから初回描画から正しい見た目で出る
  // (docs/23-検索結果表示モード計画.md §5)
  const view = parseViewMode(cookieStore.get(VIEW_MODE_COOKIE)?.value);
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
              読む物で、離すほど 1 画面に入る件数が減る */}
          <div className="space-y-2">
            <SearchForm
              initialQuery={query}
              tags={tags.map((t) => t.tag)}
              isDemo={isDemoMode()}
            />

            {/* 検索本体は Suspense で後送り。初回のドキュメント読み込み
                (ログイン直後など) は固定部が先に出て、結果は届き次第差し替わる。
                クライアント遷移 (打鍵での URL 書き換え・ページ送り) では
                このフォールバックは出ない (App Router は表示済みの内容を保つ)
                ので、既存の PendingLink のスピナーはそのまま生きる */}
            <Suspense
              fallback={
                <p
                  role="status"
                  className={`${BUSY_NOTICE_CLASS} flex items-center gap-2`}
                >
                  <span aria-hidden className={BUSY_SPINNER_CLASS} />
                  検索結果を読み込み中…
                </p>
              }
            >
              <HomeResults query={query} page={page} sort={sort} view={view} />
            </Suspense>
          </div>

          {/* 下部バーは Suspense の外に置く。検索結果を待たずに出したい
              (スキャン・画像検索は結果と無関係に押せるべき) ため。
              並び順・表示は URL と cookie から決まるので結果も要らない */}
          <BottomActionBar
            query={query}
            sort={sort}
            view={view}
            viewAction={setViewModeAction}
            sortAction={setSortAction}
            stickerHost={qrStickerHost()}
            isProd={isProductionEnv()}
          />
        </PageTransition>
      </SelectModeProvider>
    </SearchNavProvider>
  );
}

// 検索の重い部分 (DB 問い合わせと結果表示) をまとめた非公開のサーバ
// コンポーネント。Home 本体はここを await しないので、固定部が先に流れる
async function HomeResults({
  query,
  page,
  sort,
  view,
}: {
  query: string;
  page: string;
  sort: Sort;
  view: ReturnType<typeof parseViewMode>;
}) {
  // 特性表はタグ検索のときだけ出す。表は「同族の部品を並べて比べる」ビューで、
  // タグ検索がまさにその族の指定だから (docs/08-プロパティ計画.md §4)。
  const showProps = queryHasTagTerm(query);
  // 学習の進捗はチェック状態で絞り込んでいるときだけ数える
  // (docs/60-学習進捗計画.md §2)。常時出すと、チェックを使っていない
  // ノート群にも 0% が並ぶ
  const showProgress = queryTracksTaskProgress(query);
  const [result, props, trashCount, progress] = await Promise.all([
    searchItems(query, Number(page) || 1, sort),
    showProps
      ? searchItemProps(query, sort)
      : Promise.resolve({ rows: [], omitted: 0 }),
    countTrashedItems(),
    showProgress
      ? countTaskProgress(query)
      : Promise.resolve({ done: 0, total: 0 }),
  ]);

  // 0 件のときだけ引く 2 つ。どちらも独立なので並べて撃つ。
  // - 採番: スキャンした未登録コードから新規ノートを作る導線
  //   (docs/10-スキャン新規登録計画.md §3)。タグにできる語のときだけ。
  //   ヒットした検索や URL・複数語では引かない (無駄な問い合わせをしないためと、
  //   ボタンを出さないため)
  // - ゴミ箱の一致: 消したノートを探して 0 件のときに知らせる
  //   (docs/12-ゴミ箱計画.md §5)。ゴミ箱が空なら数えるまでもない
  const [nextNo, trashedMatches] = await Promise.all([
    result.total === 0 && isTaggableCode(query) ? nextItemNo() : null,
    result.total === 0 && trashCount > 0 ? countTrashedMatches(query) : 0,
  ]);
  const registerHref = nextNo === null ? null : scanRegisterHref(nextNo, query);

  // カード・masonry は広い画面で列を増やしたいので広幅。compact の
  // 1 カラムだけは読み幅を保つ (docs/23 §1, docs/32 §1)
  return (
    <SearchResults
      query={query}
      className={view === "compact" ? "" : WIDE_RESULTS_CLASS}
    >
      {/* 並び順は下部バーへ移したので、この行は件数と補助リンクだけになった
          (docs/31-下部操作バー計画.md §2)。
          件数は text-sm、その脇の補助リンクはさらに一段下げて text-xs。
          両方同じ大きさにすると、件数 (常に見る物) と補助リンク
          (たまに押す物) の区別が付かなくなる */}
      <p className="flex items-baseline gap-2 text-sm text-gray-600">
        <span>
          {query ? `「${query}」の検索結果: ` : "すべて: "}
          {result.total} 件
        </span>
        <Link href="/docs/search" className="text-xs text-blue-600 underline">
          検索ヘルプ
        </Link>
        {/* ゴミ箱が空のときは出さない (普段は目に入らないように) */}
        {trashCount > 0 && (
          <Link
            href="/trash"
            transitionTypes={["nav-forward"]}
            className="text-xs text-blue-600 underline"
          >
            ゴミ箱 ({trashCount})
          </Link>
        )}
      </p>

      {/* 件数のすぐ下に進捗。件数 (いま何件出ているか) と進捗 (全体のどこまで
          進んだか) は続けて読む物なので離さない */}
      <TaskProgress done={progress.done} total={progress.total} />

      <PropsTable
        rows={props.rows}
        omitted={props.omitted}
        query={query}
        sort={sort}
      />

      <ItemList
        items={result.items}
        query={query}
        page={result.page}
        sort={sort}
        action={bulkTagAction}
        view={view}
        trashAction={trashItemsAction}
        registerHref={registerHref}
        trashedMatches={trashedMatches}
      />

      {/* ページ送りは「前へ/次へ」からオンデマンド表示へ (docs/33)。
          searchItems が 1〜N ページの累積を返すので、末尾の「さらに表示」が
          見えたら次の page へ replace するだけで一覧が伸びる。
          全件出し切ったら何も出さない (件数は先頭に常にある) */}
      {result.page < result.pageCount && (
        <AutoLoadMore
          href={buildSearchUrl(query, result.page + 1, sort)}
          remaining={result.total - result.items.length}
        />
      )}
    </SearchResults>
  );
}
