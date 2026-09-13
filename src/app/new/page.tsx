import { redirect } from "next/navigation";
import { nextItemNo } from "@/lib/items/read";
import { requireUser } from "@/lib/session";

// 「+」から空ノートを作る入口 (docs/27-新規ノート追加計画.md)。
//
// 押した瞬間に採番して /edit/<番号> へ送るだけ。DB には何も書かない
// (副作用のない読みだけなので GET でよい)。空エディタで「更新」を押した
// ときに初めて upsert で行ができる。
//
// 採番はページ描画時ではなくこのクリック時に行う。検索ページの描画で
// 毎回引くと無駄なクエリが増え、タブを開きっぱなしにすると番号が古くなる。
// ここは redirect するだけの薄いページに保ち、新しいロジックは持ち込まない
// (採番は nextItemNo() に集約)。
//
// 認証は二重に見る。/new は publicPaths に載せていないので proxy が既定で
// 未ログインを止める (src/lib/publicPaths.ts)。ただしそれは楽観的な検査で
// あって唯一の砦にはしない (docs/18 §4) ので、採番の前に requireUser() でも
// 確かめる。
export const dynamic = "force-dynamic";

export default async function NewNotePage() {
  await requireUser();
  const itemNo = await nextItemNo();
  // redirect は NEXT_REDIRECT を throw して描画を打ち切る (return は不要)
  redirect(`/edit/${itemNo}`);
}
