// ハードロード (リロード・直リンク) ではスロットの状態を復元できないので
// null に畳む (parallel-routes.md §default.js)。プレビューは閉じた状態から
// 始まり、/item の直リンクは横取りされず全画面のページに着く
export default function Default() {
  return null;
}
