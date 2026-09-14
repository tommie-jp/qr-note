import { currentUser } from "@/lib/auth/session";
import Home from "./page";

// (search) の外からのソフト遷移 (例: /edit で保存 → /item へ redirect) で
// 横取りが起きると、children (検索ページ) の状態は復元できず、default が
// 無ければ 404 になる (next/dist/docs の default.md)。素の検索 (全件・
// 1 ページ目) にフォールバックする。default.js に searchParams は
// 渡ってこないので空で呼ぶ
//
// 未ログインなら一覧は出さず空で返す。proxy は /item の GET を素通しする
// (公開ノートのため) ので、セッションが切れたまま /trash などから /item へ
// 移ると未ログインのままここが描かれる。Home 冒頭の requireUser に任せると
// 一覧は漏れないが画面全体がエラー画面になり、@detail 側のログイン案内
// (公開ノートなら本文) まで隠れてしまう。一覧だけを伏せて案内は残す
export default async function Default() {
  if (!(await currentUser())) {
    return null;
  }
  return <Home searchParams={Promise.resolve({})} />;
}
