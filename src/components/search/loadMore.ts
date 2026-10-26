// 検索一覧の「次のページ」を、スクロールに頼らずに頼む口 (docs/116 §4)。
//
// AutoLoadMore は末尾の目印が画面に入ったら読み込む。ところが 2 / 3 ペインの
// 一覧は内側でスクロールする器 (main) の中にあり、IntersectionObserver の
// rootMargin (先読みの余白) は画面の縁にしか付かず、器の縁による切り取りには
// 効かない。画像ビューアの → で末尾の画像まで寄せても、目印は器の外に隠れた
// ままで読み込まれなかった。ビューアはこのイベントで直接頼む

export const LOAD_MORE_EVENT = "qr-note:load-more";

// AutoLoadMore の器に付ける目印。続きが無い (全件出し切った) ときは描かれない
export const AUTO_LOAD_MORE_SELECTOR = "[data-auto-load-more]";

// 続きがあれば読み込みを頼んで true、無ければ false。読み込み中に重ねて
// 頼んでも AutoLoadMore の側で 1 回にまとまる
export function requestLoadMore(): boolean {
  if (document.querySelector(AUTO_LOAD_MORE_SELECTOR) === null) {
    return false;
  }
  window.dispatchEvent(new Event(LOAD_MORE_EVENT));
  return true;
}
