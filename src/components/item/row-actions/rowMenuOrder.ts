import type { RowAction } from "./RowActions";

// 行メニューの並びとキー操作の決まり (docs/107-行メニュー計画.md §3)。
//
// DOM も React も触らない純関数にしてある。この土台の vitest は jsdom を
// 持たないので、判断だけをここへ出して検査する (lib/gesture/rowActionMenu.ts と同じ分担)。

export interface OrderedMenuAction {
  action: RowAction;
  // この項目の上に区切り線を引くか
  separatorBefore: boolean;
}

// 危険な操作 (ゴミ箱など) を末尾へ寄せ、普通の操作との境に区切り線を 1 本引く。
//
// 末尾に寄せるのは、メニューを開いた指・カーソルが最初に触れる位置から
// 遠ざけるため (⋮ の真下に開くので、先頭が一番押されやすい)。
// 危険な操作しか無いとき・普通の操作しか無いときは線を引かない — 何と何を
// 分けているのかが無い線は、ただの飾りに見える。
// 同じ側の中の並びは配列の順のまま (組む側が意図した順)
export function orderMenuActions(
  actions: readonly RowAction[],
): OrderedMenuAction[] {
  const normal = actions.filter((action) => !action.danger);
  const danger = actions.filter((action) => action.danger);
  return [
    ...normal.map((action) => ({ action, separatorBefore: false })),
    ...danger.map((action, index) => ({
      action,
      separatorBefore: index === 0 && normal.length > 0,
    })),
  ];
}

// ↑↓ Home End で次にフォーカスする項目の位置。対象外のキーは null。
//
// 端では反対側へ回り込む (WAI-ARIA のメニューの作法)。どこにも居ない
// (current = -1) ときの ↓ は先頭、↑ は末尾
export function nextMenuIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  if (count === 0) {
    return null;
  }
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
