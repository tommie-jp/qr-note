"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_PANE_MODE, type PaneMode } from "@/lib/paneMode";

interface PaneModeState {
  mode: PaneMode;
  // いまノートのペインに出ている番号。**pathname からは決まらない**
  // (docs/86 §4-4): 3 ペインでは検索語を打ち替えてもページを送っても
  // ノートを閉じないので、URL が /item/… から離れても出たままになる。
  // 一覧の行・画像タイルのハイライトはこれを見る
  shownItemNo: string | null;
  // 横取りスロット (@detail) がノートを持っているか。持っていれば
  // 「先頭を自動で選ぶ」ペイン (AutoNotePane) は引っ込む
  hasDetail: boolean;
  // 出していない間は null を流す (閉じたのに行だけ選ばれたまま、にしない)
  setDetailItemNo: (itemNo: string | null) => void;
  setAutoItemNo: (itemNo: string | null) => void;
}

const PaneModeContext = createContext<PaneModeState | null>(null);

// provider の外 (ゴミ箱の一覧など) でも呼べる。その場合はペインが無いので
// 既定の構成・ノート無しとして振る舞う
export function usePaneMode(): PaneModeState {
  return (
    useContext(PaneModeContext) ?? {
      mode: DEFAULT_PANE_MODE,
      shownItemNo: null,
      hasDetail: false,
      setDetailItemNo: () => {},
      setAutoItemNo: () => {},
    }
  );
}

// 検索画面の 3 つのペイン (フォルダー・検索結果・ノート) で構成と選択を
// 共有する (docs/86 §4-4)。(search)/layout.tsx が children と detail
// スロットの両方を包むので、どちらの側からも同じ状態が見える。
//
// 3 ペインでは detail 側の番号が消えない — 横取りスロットは「URL が
// 合わなくなっても前の中身を残す」仕様で (docs/86 §2)、ノートのペインも
// それに倣うため。一度ノートを開いたら、検索語を打ち替えても勝手に
// 先頭へ戻らない。2 / 1 ペインではペインが閉じた時点で null に戻る。
export function PaneModeProvider({
  mode,
  children,
}: {
  mode: PaneMode;
  children: ReactNode;
}) {
  const [detailItemNo, setDetail] = useState<string | null>(null);
  const [autoItemNo, setAuto] = useState<string | null>(null);

  const setDetailItemNo = useCallback((itemNo: string | null) => {
    setDetail(itemNo);
  }, []);
  const setAutoItemNo = useCallback((itemNo: string | null) => {
    setAuto(itemNo);
  }, []);

  const value = useMemo(
    () => ({
      mode,
      shownItemNo: detailItemNo ?? autoItemNo,
      hasDetail: detailItemNo !== null,
      setDetailItemNo,
      setAutoItemNo,
    }),
    [mode, detailItemNo, autoItemNo, setDetailItemNo, setAutoItemNo],
  );

  return (
    <PaneModeContext.Provider value={value}>{children}</PaneModeContext.Provider>
  );
}
