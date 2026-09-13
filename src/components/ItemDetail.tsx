import type { ComponentProps, ReactNode } from "react";
import type { Item } from "@/generated/prisma/client";
import { AutoNotePane } from "@/components/AutoNotePane";
import { ItemListNav } from "@/components/ItemListNav";
import { ItemView } from "@/components/ItemView";
import { LoginRequiredNotice } from "@/components/LoginRequiredNotice";
import { PageTransition } from "@/components/PageTransition";
import { PreviewPane } from "@/components/PreviewPane";
import { PublicItemView } from "@/components/PublicItemView";
import { RecordAccess } from "@/components/RecordAccess";
import { isProductionEnv } from "@/lib/appEnv";
import { getItem } from "@/lib/items/read";
import {
  resolveItemListContext,
  type ItemListContext,
} from "@/lib/itemListContext";
import { isPublicItem } from "@/lib/publicItem";
import { buildItemUrl } from "@/lib/searchUrl";
import { currentUser } from "@/lib/session";

// 1 ノートの詳細 (本文 + 一覧の中の前後) を、置き場所ごとの器に入れて描く
// (docs/93-リファクタリング計画.md §4-8)。器は 3 つあり、中身の組み合わせは
// どれも同じ — 別々に書いていた頃は近似クローンが 3 本並んでいた:
//
//   page … 全画面の /item (item/[itemNo]/page.tsx)。PageTransition に入れ、
//          開いたことを記録する (RecordAccess)
//   pane … /item へのソフト遷移を検索画面が横取りしたペイン
//          ((search)/@detail/(.)item/[itemNo]/page.tsx。docs/86 §2)
//   auto … 3 / 2 ペインで、まだ何も選んでいないときに検索結果の先頭を出す
//          ペイン ((search)/HomeResults.tsx。docs/86 §4-4)
//
// 置き場所を src/components にしたのは、使う側が 3 つのルートセグメント
// (item/[itemNo]・(search)/@detail・(search) の一覧) にまたがり、どれか 1 つの
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

export type ItemDetailShell =
  | {
      kind: "page";
      // recordAccessAction。'@/app/actions' をここで読まず、ページから受ける
      recordAccessAction: ComponentProps<typeof RecordAccess>["action"];
    }
  | { kind: "pane" }
  | { kind: "auto" };

interface ItemDetailProps {
  itemNo: string;
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
  | { user: string; item: Item | null; ctx: ItemListContext };

// 一覧の中の前後 (docs/60-学習進捗計画.md §4)。解決の規則 (配列の畳み方・
// resolveSort・q が無ければ引かない) は resolveItemListContext の 1 か所で、
// 3 つの器が共有する — 別々に持つと同じ URL で「次」がずれる。
//
// 引く時機は分割前の各ページのまま: 全画面はログイン中と分かってから引き、
// ペインは本文と並べて引く
async function loadDetail(
  itemNo: string,
  q: ItemDetailProps["q"],
  sort: ItemDetailProps["sort"],
  kind: ItemDetailShell["kind"],
): Promise<LoadedDetail> {
  if (kind === "page") {
    const [user, item] = await Promise.all([currentUser(), getItem(itemNo)]);
    if (user === null) {
      return { user, item };
    }
    return { user, item, ctx: await resolveItemListContext(itemNo, q, sort) };
  }

  const [user, item, ctx] = await Promise.all([
    currentUser(),
    getItem(itemNo),
    resolveItemListContext(itemNo, q, sort),
  ]);
  return user === null ? { user, item } : { user, item, ctx };
}

export async function ItemDetail({
  itemNo,
  q,
  sort,
  saved,
  shell,
}: ItemDetailProps) {
  const loaded = await loadDetail(itemNo, q, sort, shell.kind);

  if (loaded.user === null) {
    return renderLoggedOut(itemNo, loaded.item, shell);
  }

  const { item, ctx } = loaded;
  const view = <ItemView itemNo={itemNo} item={item} saved={saved} />;
  // page … 本文の下 (タイムスタンプの下)。問題を解いて読み終えたところに
  //        「次」があるのが自然な流れ
  // pane / auto … ペインの中の「前 / 次」も Link なのでまた横取りされ、
  //        ペインのまま一覧の並びを歩ける
  const nav = (
    <ItemListNav
      prev={ctx.neighbors.prev}
      next={ctx.neighbors.next}
      query={ctx.query}
      sort={ctx.sort}
    />
  );
  const openHref = buildItemUrl(itemNo, ctx.query, ctx.sort);

  switch (shell.kind) {
    case "page":
      return (
        <PageTransition>
          {/* 「最近見た順」のための記録 (docs/37-アクセス順計画.md)。
              **ログイン中の枝にだけ置く** — 未ログイン枝 (公開ノート) に
              置くと、他人やクローラが開くたびに自分の並びが書き換わる。
              描画では記録せずマウント後に呼ぶ理由は RecordAccess.tsx に書いた。
              ペイン (pane / auto) には置かない (docs/86 §3) */}
          <RecordAccess itemNo={itemNo} action={shell.recordAccessAction} />
          {view}
          {nav}
        </PageTransition>
      );
    case "pane":
      return (
        // key … ノート間をペインのまま移ったとき器を作り直し、前のノートの
        // スクロール位置を持ち越さない
        <PreviewPane
          key={itemNo}
          bgClass={paneBgClass()}
          itemNo={itemNo}
          openHref={openHref}
        >
          {view}
          {nav}
        </PreviewPane>
      );
    case "auto":
      return (
        <AutoNotePane
          key={itemNo}
          bgClass={paneBgClass()}
          itemNo={itemNo}
          openHref={openHref}
        >
          {view}
          {nav}
        </AutoNotePane>
      );
  }
}

function renderLoggedOut(
  itemNo: string,
  item: Item | null,
  shell: ItemDetailShell,
): ReactNode {
  const body = isPublicItem(item) ? (
    <PublicItemView itemNo={itemNo} item={item} />
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
          openHref={`/item/${encodeURIComponent(itemNo)}`}
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
