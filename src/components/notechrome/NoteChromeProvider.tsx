"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ノートの操作を畳んで重ねる仕掛けの状態 (docs/108-ノート全画面表示計画.md §3-2)。
//
// 差し込み口 (上端の行の 2 か所) は NoteChromeBar が、中身は MemoPanel が
// 持つ。両者の間には Server Component (ItemView) が挟まって props が
// 通らないので、ノートの器 (ペイン・全画面) ごとに 1 つこの context で繋ぐ。
//
// 開いている理由は 3 つ別々に持つ。1 つの真偽にすると、⋯ で開いたまま
// マウスが行を離れた瞬間に閉じる・Tab で入って ⋯ を押したら閉じる、のように
// 理由の違う操作が互いを打ち消す
export interface NoteChromeState {
  // 呼び口 (⋯ と公開中の印) を差し込む所
  triggerSlot: HTMLElement | null;
  // 重ねる面を差し込む所 (行の直下)
  overlaySlot: HTMLElement | null;
  // いま重ねる面を出しているか
  revealed: boolean;
  setTriggerSlot: (element: HTMLElement | null) => void;
  setOverlaySlot: (element: HTMLElement | null) => void;
  // PC のマウスが行 (と重ねた面) に入った / 出た。delayMs だけ待ってから効かせる
  // (かすめただけで開かない・面へ移る隙間で閉じない)
  scheduleHover: (hovered: boolean, delayMs: number) => void;
  // キーボードのフォーカス (focus-visible) が行の中に居る
  setFocused: (focused: boolean) => void;
  // ⋯ を押した。閉じていれば開き、開いていれば (理由を問わず) 閉じる
  toggle: () => void;
  // 開いている理由をすべて捨てて閉じる (外を押した・Esc・タブを選んだ)
  dismiss: () => void;
}

const NoteChromeContext = createContext<NoteChromeState | null>(null);

// 器の外 (公開ビュー・テスト) では null。MemoPanel はそれを「畳めない」と読む
export function useNoteChrome(): NoteChromeState | null {
  return useContext(NoteChromeContext);
}

export function NoteChromeProvider({ children }: { children: ReactNode }) {
  const [triggerSlot, setTriggerSlot] = useState<HTMLElement | null>(null);
  const [overlaySlot, setOverlaySlot] = useState<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [clicked, setClicked] = useState(false);

  // ホバーの予約。**閉じるときに必ず取り消す** — ⋯ を押す瞬間にマウスが行へ
  // 入って開く予約が入り、すぐ面のタブを選んで閉じても、予約が後から発火して
  // 面を開き直す。マウスはもう行の外なので離れる合図も来ず、開きっぱなしに
  // なった (E2E で判明)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleHover = useCallback((next: boolean, delayMs: number) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(next), delayMs);
  }, []);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const revealed = hovered || focused || clicked;
  // 出ているときに押したら、理由を問わず閉じる。clicked だけを反転させると、
  // Tab で入って (focused) Enter で ⋯ を押しても閉じられない (レビューで判明)
  const toggle = useCallback(() => {
    if (revealed) {
      clearTimeout(hoverTimer.current);
      setHovered(false);
      setFocused(false);
      setClicked(false);
    } else {
      setClicked(true);
    }
  }, [revealed]);
  // 外を押した・Esc・タブを選んだ。ホバーの分も閉じる — PC で重ねた面から
  // タブを選んだとき、マウスが面の上に残っていても閉じて中身を見せる。
  // 行を一度離れて戻れば、またホバーで出る
  const dismiss = useCallback(() => {
    clearTimeout(hoverTimer.current);
    setHovered(false);
    setClicked(false);
    setFocused(false);
  }, []);

  const value = useMemo(
    () => ({
      triggerSlot,
      overlaySlot,
      revealed,
      setTriggerSlot,
      setOverlaySlot,
      scheduleHover,
      setFocused,
      toggle,
      dismiss,
    }),
    [triggerSlot, overlaySlot, revealed, scheduleHover, toggle, dismiss],
  );

  return (
    <NoteChromeContext.Provider value={value}>
      {children}
    </NoteChromeContext.Provider>
  );
}
