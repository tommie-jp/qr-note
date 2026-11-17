import type { ViewerTarget } from "@/lib/images/viewerNav";

// 一覧に並んでいる「押せる画像」を DOM の順で拾う (docs/116 §4)。
// 無限スクロールは読み込んだページごとに別の一覧を描くので、どれか 1 つの
// 一覧の props からは「次の 1 枚」が決まらない。画面に並んでいる順が
// そのまま利用者の見ている順なので、目印 (data-viewer-*) から組み立てる
const OPENER_SELECTOR = "[data-viewer-image]";

export function openersInPage(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(OPENER_SELECTOR)];
}

export function targetOf(el: HTMLElement): ViewerTarget {
  return {
    itemId: el.dataset.viewerItem ?? "",
    name: el.dataset.viewerImage ?? "",
    href: el.dataset.viewerHref ?? "",
  };
}

// ← → を受けるのは、焦点が「どこにも無い (body)」か、一覧・ビューアの中に
// あるときだけ。押した釦 (一覧の画像) に焦点が残るので、開いた直後から効く。
// メニュー・検索パネル・スキャナなど矢印を自分で使う部品に焦点があるときは
// 奪わない (ペインが Esc を持たないのと同じ配慮。docs/86 §2)。
// 一覧の中でも文字の入力欄は除く
const ARROW_SCOPE_SELECTOR = "[data-search-results], [data-image-viewer]";

export function acceptsArrowKeys(target: EventTarget | null): boolean {
  if (target === document.body || target === null) {
    return true;
  }
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  ) {
    return false;
  }
  return target.closest(ARROW_SCOPE_SELECTOR) !== null;
}
