import { cookies } from "next/headers";
import Link from "next/link";
import { cache, Suspense } from "react";
import {
  bulkTagAction,
  setItemsOfflinePinAction,
  setSortAction,
  setViewModeAction,
  trashItemsAction,
} from "@/app/actions";
import { AutoLoadMore } from "@/components/AutoLoadMore";
import { AutoNotePane } from "@/components/AutoNotePane";
import { BottomActionBar } from "@/components/BottomActionBar";
import { ItemListNav } from "@/components/ItemListNav";
import { ItemView } from "@/components/ItemView";
import { FolderPane } from "@/components/FolderPane";
import { ItemList } from "@/components/ItemList";
import { TrashIcon } from "@/components/MenuIcons";
import { PageTransition } from "@/components/PageTransition";
import { PropsTable } from "@/components/PropsTable";
import PullToRefresh from "@/components/PullToRefresh";
import { SearchForm } from "@/components/SearchForm";
import { SearchNavProvider, SearchResults } from "@/components/SearchNav";
import { SelectModeProvider } from "@/components/SelectModeProvider";
import { TaskProgress } from "@/components/TaskProgress";
import { BUSY_NOTICE_CLASS, BUSY_SPINNER_CLASS } from "@/components/ui";
import { isDemoMode, isProductionEnv } from "@/lib/appEnv";
import {
  countFolderTotals,
  countTaskProgress,
  countTrashedItems,
  countTrashedMatches,
  listTags,
  nextItemNo,
  searchItemProps,
  searchItems,
  type TagCount,
} from "@/lib/items";
import { loadCircuitThumbs } from "@/lib/circuitThumbs";
import { buildMathSummaries, buildMathTexts } from "@/lib/mathText";
import { buildNotePreviews } from "@/components/NotePreviewThumb";
import { isTaggableCode, scanRegisterHref } from "@/lib/scanRegister";
import {
  PANE_MODE_COOKIE,
  parsePaneMode,
  showsFolderPane,
  type PaneMode,
} from "@/lib/paneMode";
import { resolveItemListContext } from "@/lib/itemListContext";
import { getItem } from "@/lib/items";
import { queryHasTagTerm, queryTracksTaskProgress } from "@/lib/search";
import { listQueries } from "@/lib/searchQueryStore";
import { currentUser } from "@/lib/session";
import { buildItemUrl, buildSearchUrl } from "@/lib/searchUrl";
import { qrStickerHost } from "@/lib/site";
import { SORT_COOKIE, resolveSort } from "@/lib/sortMode";
import type { Sort } from "@/lib/validation";
import { parseViewMode, VIEW_MODE_COOKIE } from "@/lib/viewMode";

export const dynamic = "force-dynamic";

// ゴミ箱の件数は HomeResults (0 件時の案内) と SearchFolders (フォルダーの
// バッジ) の両方が使う。別々の Suspense 枝から呼んでも 1 回の問い合わせに
// 畳むため、リクエスト単位で memo する (React の cache)
const countTrashedItemsOnce = cache(countTrashedItems);

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
  // ペイン構成 (docs/86 §4-4)。フォルダーを出すか、先頭のノートを自動で
  // 選ぶかがここで決まる。**サーバで決めるのが要点** — クライアントで
  // 隠すだけだと、出さない構成でもタグの集計を引いてしまう
  const paneMode = parsePaneMode(cookieStore.get(PANE_MODE_COOKIE)?.value);
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
              <HomeResults
                query={query}
                page={page}
                sort={sort}
                view={view}
                paneMode={paneMode}
              />
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

// 検索フォルダーの件数を引いて描く (docs/86 §5)。HomeResults と同じ
// 「重い部分を隔離して後から流す」作り。タグ一覧は Home が補完用に
// 引いたものを使い回す (同じ表を二度引かない)
async function SearchFolders({
  tags,
  query,
  sort,
}: {
  tags: TagCount[];
  query: string;
  sort: Sort;
}) {
  // ☆ 登録パターン (docs/59 §7) はユーザーごと。この画面は門番 (proxy) の
  // 内側だが、万一の未ログインは空で受ける (ペインの他の節は個人情報でない)
  const user = await currentUser();
  const [totals, trashCount, queryLists] = await Promise.all([
    countFolderTotals(),
    countTrashedItemsOnce(),
    user ? listQueries(user) : Promise.resolve({ saved: [], recent: [] }),
  ]);
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

// 検索の重い部分 (DB 問い合わせと結果表示) をまとめた非公開のサーバ
// コンポーネント。Home 本体はここを await しないので、固定部が先に流れる
async function HomeResults({
  query,
  page,
  sort,
  view,
  paneMode,
}: {
  query: string;
  page: string;
  sort: Sort;
  view: ReturnType<typeof parseViewMode>;
  paneMode: PaneMode;
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
    countTrashedItemsOnce(),
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

  // 一覧に出す回路図サムネ (docs/68-一覧回路図サムネ計画.md)。キャッシュ済みの
  // SVG を引くだけで描画はしない。小/大は画像の無いノートの先頭 1 枚、
  // 画像モードは全部 (表示モードはサーバで既知なので引く量を絞れる)
  const circuitThumbs = await loadCircuitThumbs(
    result.items,
    view === "image" ? "all" : "first",
  );

  // タイトル・プレビューの数式を KaTeX の HTML に (docs/69-一覧数式計画.md)。
  // DB は引かない同期処理。プレビューが描かれるのはカード表示だけなので、
  // それ以外はタイトルだけ作る (circuitThumbs の mode と同じ考え)。
  // 特性表の要約列はタイトルと同じ文字列なので描画を使い回す
  const mathTexts = buildMathTexts(
    result.items,
    view === "card" ? "both" : "title",
  );
  const mathSummaries = buildMathSummaries(props.rows, mathTexts);

  // 画像も回路図も無いノートの顔になる、本文の縮小プレビュー
  // (docs/71-一覧ノートプレビュー計画.md)。DB は引かない同期処理。
  // **回路図サムネの後に作る** (出るノートに作っても使われない)。
  // 表示モードごとの出し分け (画像モードは作らない・小はさらに足切り) は
  // buildNotePreviews の中 (circuitThumbs / mathTexts と同じ作法)
  const notePreviews = buildNotePreviews(result.items, circuitThumbs, view);

  // 3 ペインでは**必ずノートを出す** (docs/86 §4-4)。まだ何も選んでいない
  // ときのために、検索結果の先頭を器ごと用意しておく。
  //
  // URL は動かさない — router.replace で /item/<先頭> へ飛ばすと、
  // 再読み込みした瞬間に横取りの外 (全画面のノート) へ着地して 3 ペインが
  // 消える。ここで描けば URL は検索のまま保てる。
  // 中身の重さは一覧のプレビュー (buildNotePreviews は最大 20 ノートぶんの
  // markdown を描く) と同じ桁で、1 ノート増えるだけ
  const first = showsFolderPane(paneMode) ? result.items[0] : undefined;
  const autoNote = first ? await buildAutoNote(first.itemNo, query, sort) : null;

  // カード・masonry は広い画面で列を増やしたいので広幅。compact の
  // 1 カラムだけは読み幅を保つ (docs/23 §1, docs/32 §1)
  return (
    <>
    {/* 3 ペインでまだ何も選んでいないときに出す、先頭ノートのペイン
        (docs/86 §4-4)。**SearchResults の外に置く** — あちらはカード表示で
        breakout の transform を持ち、transform のある要素は position:fixed の
        包含ブロックになる (下部バーを nav の外へ出しているのと同じ罠)。
        中に入れるとペインが一覧の幅の中へ縮んで浮く。
        出すかどうかの最終判断はクライアント側 (AutoNotePane) —
        横取りスロットが既にノートを持っていたら引っ込む */}
    {autoNote}
    {/* 幅の指定は持たない。ペイン 2 の器いっぱいに広げる (docs/86 §4-8) —
        広幅 breakout (WIDE_RESULTS_CLASS) は「中央 max-w-2xl の器から
        はみ出す」ための道具で、器がもうペイン幅いっぱいなら要らない */}
    <SearchResults query={query}>
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
        {/* **絵と記号に詰める** (件数の行を短くするため)。ここは件数を読みに
            来る行で、補助リンクは「あることを知っている人が押す物」なので、
            文字で名乗り続ける必要がない。読み上げには aria-label で言葉を残す。
            丸で囲むのは「？」1 文字だとリンクに見えないため */}
        <Link
          href="/docs/search"
          aria-label="検索ヘルプ"
          title="検索ヘルプ"
          className="rounded-full border border-blue-300 px-1.5 text-xs leading-4 text-blue-600"
        >
          ?
        </Link>
        {/* ゴミ箱が空のときは出さない (普段は目に入らないように) */}
        {trashCount > 0 && (
          <Link
            href="/trash"
            transitionTypes={["nav-forward"]}
            aria-label={`ゴミ箱 (${trashCount} 件)`}
            title="ゴミ箱"
            className="inline-flex items-center gap-0.5 self-center text-xs text-blue-600"
          >
            <TrashIcon small />({trashCount})
          </Link>
        )}
      </p>

      {/* 件数のすぐ下に進捗。件数 (いま何件出ているか) と進捗 (全体のどこまで
          進んだか) は続けて読む物なので離さない */}
      <TaskProgress done={progress.done} total={progress.total} />

      {/* **送るのはここだけ** (docs/86 §4-6)。検索窓・件数・進捗は動かさず、
          一覧 (と特性表・ページ送り) だけを内側でスクロールさせる。
          スクロールバーもこの器に付くので、一覧の右端に沿う */}
      <div data-results-scroll className="space-y-2">
      <PropsTable
        rows={props.rows}
        omitted={props.omitted}
        query={query}
        sort={sort}
        mathSummaries={mathSummaries}
      />

      <ItemList
        items={result.items}
        query={query}
        page={result.page}
        sort={sort}
        action={bulkTagAction}
        view={view}
        trashAction={trashItemsAction}
        pinAction={setItemsOfflinePinAction}
        registerHref={registerHref}
        trashedMatches={trashedMatches}
        circuitThumbs={circuitThumbs}
        mathTexts={mathTexts}
        notePreviews={notePreviews}
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
      </div>
    </SearchResults>
    </>
  );
}

// 自動で選んだ先頭ノートの中身。横取りしたペイン
// ((search)/@detail/(.)item/[itemNo]/page.tsx) と同じ組み合わせを、
// 同じ道具 (resolveItemListContext) で組み立てる
async function buildAutoNote(itemNo: string, query: string, sort: Sort) {
  const [item, ctx] = await Promise.all([
    getItem(itemNo),
    resolveItemListContext(itemNo, query, sort),
  ]);
  return (
    <AutoNotePane
      key={itemNo}
      bgClass={isProductionEnv() ? "bg-gray-50" : "bg-pink-50"}
      itemNo={itemNo}
      openHref={buildItemUrl(itemNo, ctx.query, ctx.sort)}
    >
      <ItemView itemNo={itemNo} item={item} />
      <ItemListNav
        prev={ctx.neighbors.prev}
        next={ctx.neighbors.next}
        query={ctx.query}
        sort={ctx.sort}
      />
    </AutoNotePane>
  );
}
