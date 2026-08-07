import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ItemListNav } from "@/components/ItemListNav";
import { ItemView } from "@/components/ItemView";
import { LoginRequiredNotice } from "@/components/LoginRequiredNotice";
import { PageTransition } from "@/components/PageTransition";
import { PublicItemView } from "@/components/PublicItemView";
import { RecordAccess } from "@/components/RecordAccess";
import { recordAccessAction } from "@/app/actions";
import { findListNeighbors, getItem } from "@/lib/items";
import { isPublicItem } from "@/lib/publicItem";
import { currentUser } from "@/lib/session";
import { SORT_COOKIE, resolveSort } from "@/lib/sortMode";
import { isValidItemNo } from "@/lib/validation";

export const dynamic = "force-dynamic";

// 公開ノートは検索エンジンに載せない (docs/22-ノート公開計画.md §8)。
// 「URL を知っている人に見せる」であって「web に公開する」ではない。
// itemNo は連番なので、1 件でもクロールされると辿られる。
// 既定は狭いほうへ倒しておき、載せたくなったら外す
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface ItemPageProps {
  params: Promise<{ itemNo: string }>;
  // saved … 更新直後だけ付く保存時刻。トーストを出す印 (docs/11 §2-3)
  // q / sort … 一覧から開いたときに持ち回している検索状態。
  //   これがあるときだけ前後ナビを出す (docs/60-学習進捗計画.md §4)。
  //   同じ名前を 2 回書いた URL (`?q=a&q=b`) では配列で届くので、型でも
  //   その形を認め、下で 1 本に畳んでから使う
  searchParams: Promise<{
    saved?: string;
    q?: string | string[];
    sort?: string | string[];
  }>;
}

// QR シールの飛び先。
//
// このページは proxy.ts が**未ログインでも素通しする**口
// (publicPaths.ts の isSelfGuardedPath。docs/22 §1)。素通しした以上、
// 誰に何を見せるかはここが決める。門番を当てにしない:
//
//   ログイン中        → ItemView (従来の画面 + 公開トグル)
//   未ログイン & 公開 → PublicItemView (読み取り専用)
//   それ以外          → ログインの案内
//
// **未登録・非公開・ゴミ箱を同じ応答に潰すのが要点** (docs/22 §4)。
// 分けると /item/1, /item/2, … を順に叩くだけでノートの存在が数えられる。
// isPublicItem() が 3 つとも false に畳んでくれるので、ここは 1 本の if で済む。
export default async function ItemPage({ params, searchParams }: ItemPageProps) {
  const { itemNo } = await params;
  if (!isValidItemNo(itemNo)) {
    notFound();
  }

  const [user, item, { saved, q, sort: sortParam }] = await Promise.all([
    currentUser(),
    getItem(itemNo),
    searchParams,
  ]);

  if (user === null) {
    return (
      <PageTransition>
        {isPublicItem(item) ? (
          <PublicItemView itemNo={itemNo} item={item} />
        ) : (
          <LoginRequiredNotice />
        )}
      </PageTransition>
    );
  }

  // 一覧の中の前後 (docs/60-学習進捗計画.md §4)。検索状態を持って来ていない
  // (QR シールから直接開いた) ときは引かない。
  //
  // 並び順は検索ページと同じ resolveSort (URL → cookie → 既定) で決める。
  // cookie だけを見ると `?sort=` 付きの共有リンクから入ったときに一覧と
  // 順序が食い違い、「次」が一覧の次の行とずれる
  // 配列で届いた (`?q=a&q=b`) ときは先頭を採る。落として素の URL 扱いにすると
  // 「一覧から来たのにナビが無い」になるので、値があるなら 1 つ選ぶ
  const query = (Array.isArray(q) ? (q[0] ?? "") : (q ?? "")).trim();
  // resolveSort は unknown を受けて parseSort で畳むので、配列はそのまま
  // 渡してよい (知らない値として既定へ倒れる)
  const sort = resolveSort(sortParam, (await cookies()).get(SORT_COOKIE)?.value);
  const neighbors = query
    ? await findListNeighbors(query, sort, itemNo)
    : { prev: null, next: null };

  return (
    <PageTransition>
      {/* 「最近見た順」のための記録 (docs/37-アクセス順計画.md)。
          **ログイン中の枝にだけ置く** — 上の未ログイン枝 (公開ノート) に
          置くと、他人やクローラが開くたびに自分の並びが書き換わる。
          描画では記録せずマウント後に呼ぶ理由は RecordAccess.tsx に書いた */}
      <RecordAccess itemNo={itemNo} action={recordAccessAction} />
      <ItemView itemNo={itemNo} item={item} saved={saved} />
      {/* 本文の下 (タイムスタンプの下)。問題を解いて読み終えたところに
          「次」があるのが自然な流れ */}
      <ItemListNav
        prev={neighbors.prev}
        next={neighbors.next}
        query={query}
        sort={sort}
      />
    </PageTransition>
  );
}
