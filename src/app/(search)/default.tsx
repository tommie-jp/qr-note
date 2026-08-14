import Home from "./page";

// (search) の外からのソフト遷移 (例: /edit で保存 → /item へ redirect) で
// 横取りが起きると、children (検索ページ) の状態は復元できず、default が
// 無ければ 404 になる (next/dist/docs の default.md)。素の検索 (全件・
// 1 ページ目) にフォールバックする。default.js に searchParams は
// 渡ってこないので空で呼ぶ
export default function Default() {
  return <Home searchParams={Promise.resolve({})} />;
}
