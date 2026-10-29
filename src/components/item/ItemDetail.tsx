import type { ReactNode } from "react";
import type { Item } from "@/generated/prisma/client";
import { AutoNotePane } from "@/components/notepage/AutoNotePane";
import { CloseNoteButton } from "@/components/item/CloseNoteButton";
import { NoteNav } from "@/components/item/NoteNav";
import { NoteView } from "@/components/item/NoteView";
import { NoteChromeBar } from "@/components/notechrome/NoteChromeBar";
import { NoteChromeProvider } from "@/components/notechrome/NoteChromeProvider";
import { LoginRequiredNotice } from "@/components/auth/LoginRequiredNotice";
import { PageTransition } from "@/components/chrome/PageTransition";
import { PreviewPane } from "@/components/panes/PreviewPane";
import { PublicItemView } from "@/components/item/PublicItemView";
import { RecordAccess } from "@/components/item/RecordAccess";
import { isDemoMode, isProductionEnv } from "@/lib/appEnv";
import { getItem } from "@/lib/items/read";
import {
  resolveListParams,
  type ListParams,
} from "@/lib/prefs/itemListContext";
import { isPublicItem } from "@/lib/auth/publicItem";
import { buildItemUrl, buildSearchUrl } from "@/lib/search/url";
import { currentUser } from "@/lib/auth/session";

// 1 ノートの詳細 (本文 + 一覧の中の前後) を、置き場所ごとの器に入れて描く
// (docs/93-リファクタリング計画.md §4-8)。器は 3 つあり、中身の組み合わせは
// どれも同じ — 別々に書いていた頃は近似クローンが 3 本並んでいた:
//
//   page … 全画面の /item (item/[itemId]/page.tsx)。PageTransition に入れ、
//          開いたことを記録する (RecordAccess)
//   pane … /item へのソフト遷移を検索画面が横取りしたペイン
//          ((search)/@detail/(.)item/[itemId]/page.tsx。docs/86 §2)
//   auto … 3 / 2 ペインで、まだ何も選んでいないときに検索結果の先頭を出す
//          ペイン ((search)/HomeResults.tsx。docs/86 §4-4)
//
// 置き場所を src/components にしたのは、使う側が 3 つのルートセグメント
// (item/[itemId]・(search)/@detail・(search) の一覧) にまたがり、どれか 1 つの
// ルートの持ち物ではないため。中身の ItemView・PublicItemView・PreviewPane も
// ここに居る。番号の形の検査 (404 にするか、ペインの中で知らせるか) は
// 器ごとに違うので呼ぶ側 (page.tsx) に残す。
//
// 誰に何を見せるか:
//
//   ログイン中        → ItemView (従来の画面 + 公開トグル)
//   未ログイン & 公開 → PublicItemView (読み取り専用)
//   それ以外          → ログインの案内
//
// **未登録・非公開・ゴミ箱を同じ応答に潰すのが要点** (docs/22 §4)。
// 分けると /item/1, /item/2, … を順に叩くだけでノートの存在が数えられる。
// isPublicItem() が 3 つとも false に畳んでくれるので、ここは 1 本の if で済む。

export type ItemDetailShell = { kind: "page" } | { kind: "pane" } | { kind: "auto" };

interface ItemDetailProps {
  itemId: string;
  // 一覧から開いたときに持ち回している検索状態。同じ名前を 2 回書いた URL
  // (`?q=a&q=b`) では配列で届くので、その形のまま受けて
  // resolveItemListContext が 1 本に畳む
  q: string | string[] | undefined;
  sort: string | string[] | undefined;
  // 更新直後だけ付く保存時刻。トーストを出す印 (docs/11 §2-3)
  saved?: string;
  shell: ItemDetailShell;
}

// ペインの地色。本番=灰 / ローカル=ピンク (LOCAL の目印はプレビューでも
// 失わない)。env はサーバでしか読めないので、ここで決めて渡す
export const paneBgClass = () =>
  isProductionEnv() ? "bg-gray-50" : "bg-pink-50";

type LoadedDetail =
  | { user: null; item: Item | null }
  | { user: string; params: ListParams };

// 器を組む前に待つのはログインと一覧の文脈 (cookie の並び順) だけ
// (docs/123 §4-1)。**ログイン中はノートを DB から引かない** — 本文は端末が
// API から取る (一覧から開いたときは一覧の応答で既に持っている)。
// 未ログインのときだけ、公開ノートかどうかを見るためにここで引く
async function loadDetail(
  itemId: string,
  q: ItemDetailProps["q"],
  sort: ItemDetailProps["sort"],
): Promise<LoadedDetail> {
  const user = await currentUser();
  if (user === null) {
    return { user, item: await getItem(itemId) };
  }
  return { user, params: await resolveListParams(q, sort) };
}

export async function ItemDetail({
  itemId,
  q,
  sort,
  saved,
  shell,
}: ItemDetailProps) {
  const loaded = await loadDetail(itemId, q, sort);

  if (loaded.user === null) {
    return renderLoggedOut(itemId, loaded.item, shell);
  }

  const { params } = loaded;
  const view = <NoteView itemId={itemId} saved={saved} isDemo={isDemoMode()} shell={shell.kind} />;
  // page … 本文の下 (タイムスタンプの下)。問題を解いて読み終えたところに
  //        「次」があるのが自然な流れ
  // pane / auto … ペインの中の「前 / 次」も Link なのでまた横取りされ、
  //        ペインのまま一覧の並びを歩ける
  const nav = <NoteNav itemId={itemId} query={params.query} sort={params.sort} />;
  const openHref = buildItemUrl(itemId, params.query, params.sort);

  switch (shell.kind) {
    case "page":
      return (
        <PageTransition>
          {/* 「最近見た順」のための記録 (docs/37-アクセス順計画.md)。
              **ログイン中の枝にだけ置く** — 未ログイン枝 (公開ノート) に
              置くと、他人やクローラが開くたびに自分の並びが書き換わる。
              描画では記録せずマウント後に呼ぶ理由は components/item/RecordAccess.tsx に書いた。
              ペイン (pane / auto) には置かない (docs/86 §3) */}
          <RecordAccess itemId={itemId} />
          {/* ペインの操作行 (PreviewPane) と同じ位置に「閉じる」を置く
              (docs/86 §4-17)。「全画面で開く」で来た後も同じ所で閉じられる。
              **ログイン中の枝だけ** — 未ログインの公開ノートには一覧が無い */}
          {/* 行はヘッダーの下に貼り付け、直下にノートの操作を重ねる
              (docs/108 §3-1)。地色は body と同じ (paneBgClass) にして、下を
              通る本文を透けさせない。左右の余白は main (px-safe) が持つ */}
          <NoteChromeProvider>
            <NoteChromeBar
              className="sticky top-[var(--header-h)] z-10"
              bgClass={paneBgClass()}
              rowClassName="pt-1"
              start={
                <CloseNoteButton
                  listHref={buildSearchUrl(params.query, 1, params.sort)}
                />
              }
            />
            {view}
          </NoteChromeProvider>
          {nav}
        </PageTransition>
      );
    case "pane":
      return (
        // key … ノート間をペインのまま移ったとき器を作り直し、前のノートの
        // スクロール位置を持ち越さない
        <PreviewPane
          key={itemId}
          bgClass={paneBgClass()}
          itemId={itemId}
          openHref={openHref}
        >
          {view}
          {nav}
        </PreviewPane>
      );
    case "auto":
      return (
        <AutoNotePane
          key={itemId}
          bgClass={paneBgClass()}
          itemId={itemId}
          openHref={openHref}
        >
          {view}
          {nav}
        </AutoNotePane>
      );
  }
}

function renderLoggedOut(
  itemId: string,
  item: Item | null,
  shell: ItemDetailShell,
): ReactNode {
  const body = isPublicItem(item) ? (
    <PublicItemView itemId={itemId} item={item} />
  ) : (
    <LoginRequiredNotice />
  );

  switch (shell.kind) {
    case "page":
      return <PageTransition>{body}</PageTransition>;
    case "pane":
      // セッション切れでも黙って消えない (全画面側の分岐と同じ受け皿を
      // ペインの器で出す)。proxy は /item を素通しするので、ここが門番
      return (
        <PreviewPane
          bgClass={paneBgClass()}
          openHref={`/item/${encodeURIComponent(itemId)}`}
        >
          {body}
        </PreviewPane>
      );
    case "auto":
      // 自動のペインは検索ページ (Home 冒頭の requireUser を通った後) にしか
      // 出ないので、ここへは来ない。万一の未ログインでも本文を出さない
      return null;
  }
}
