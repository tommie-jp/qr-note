// Navigation API (navigation.canGoBack / canGoForward) の最小の窓口。
// ヘッダーの ◀ ▶ (HistoryNav) と全画面ノートの「閉じる」(CloseNoteButton) が
// 同じ判定を使う。
//
// Chrome/Edge 102+・Firefox 147+・Safari 26.2+ が対応。未対応なら null を返し、
// どう倒すかは使う側が決める (◀ は押せるまま、「閉じる」は一覧へ)。
//
// entries は同じオリジンの履歴だけを数えるので、canGoBack が true なら
// 「戻った先もこのアプリ」と言える (history.length は外のサイトも数える)。

// TS の lib.dom.d.ts にはまだ Navigation API が無いので、使う分だけ最小宣言する。
export interface NavigationHistoryEntry {
  readonly key: string;
  readonly index: number;
  readonly url: string | null;
}

export interface NavigationApi extends EventTarget {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly currentEntry: NavigationHistoryEntry | null;
  entries(): NavigationHistoryEntry[];
  traverseTo(key: string): { finished: Promise<unknown> };
}

export function getNavigation(): NavigationApi | null {
  if (typeof window === "undefined" || !("navigation" in window)) return null;
  return (window as unknown as { navigation: NavigationApi }).navigation;
}
