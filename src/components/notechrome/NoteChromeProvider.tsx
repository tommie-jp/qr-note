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
  // いま積む形 (常に出す・編集タブ) か。畳む形なら false。
  // 持ち主 (MemoPanel) が決めて知らせる。帯 (NoteChromeBar) は畳む形のときだけ
  // 本文の上に浮く (docs/108 §3-6) — 積む形で浮かせると見出し行の右端
  // (編集 / 履歴 / QR / 記法) に札が重なる
  inline: boolean;
  setInline: (inline: boolean) => void;
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
  // 既定は畳む形 (サーバ描画と同じ)。積む形は持ち主がマウント後に知らせる
  const [inline, setInline] = useState(false);

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
      inline,
      setTriggerSlot,
      setOverlaySlot,
      scheduleHover,
      setFocused,
      setInline,
      toggle,
      dismiss,
    }),
    [triggerSlot, overlaySlot, revealed, inline, scheduleHover, toggle, dismiss],
  );

  return (
    <NoteChromeContext.Provider value={value}>
      {children}
    </NoteChromeContext.Provider>
  );
}
