"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_PANE_MODE,
  showsFolderPane,
  type PaneMode,
} from "@/lib/prefs/paneMode";
import { useShownPaneMode } from "@/lib/prefs/pendingPaneMode";
import { noteHintFromClick, noteHintStore } from "@/components/panes/noteHint";

interface PaneModeState {
  mode: PaneMode;
  // いまノートのペインに出ている番号。**pathname からは決まらない**
  // (docs/86 §4-4): 3 ペインでは検索語を打ち替えてもページを送っても
  // ノートを閉じないので、URL が /item/… から離れても出たままになる。
  // 一覧の行・画像タイルのハイライトはこれを見る
  shownItemId: string | null;
  // 横取りスロット (@detail) がノートを持っているか。持っていれば
  // 「先頭を自動で選ぶ」ペイン (AutoNotePane) は引っ込む
  hasDetail: boolean;
  // 横取りスロットが出しているノート (利用者が自分で選んだもの)。自動の
  // ノートは含まない。画像ビューアが「別のノートを選んだら引っ込む」の
  // 判定に使う — 自動のノートは一覧より遅れて届くので、shownItemId で見ると
  // 届いた瞬間に開いたばかりの画像が閉じる (docs/116 §5)
  detailItemId: string | null;
  // 出していない間は null を流す (閉じたのに行だけ選ばれたまま、にしない)
  setDetailItemId: (itemId: string | null) => void;
  setAutoItemId: (itemId: string | null) => void;
}

const PaneModeContext = createContext<PaneModeState | null>(null);

// provider の外 (ゴミ箱の一覧など) でも呼べる。その場合はペインが無いので
// 既定の構成・ノート無しとして振る舞う
export function usePaneMode(): PaneModeState {
  return (
    useContext(PaneModeContext) ?? {
      mode: DEFAULT_PANE_MODE,
      shownItemId: null,
      hasDetail: false,
      detailItemId: null,
      setDetailItemId: () => {},
      setAutoItemId: () => {},
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
//
// mode は cookie の値。**押した直後は送った先の構成を重ねて配る**
// (docs/86 §4-18) — ヘッダーの釦が送った先を pendingPaneMode に置くので、
// サーバの描き直しを待たずに器の積み方が変わる
export function PaneModeProvider({
  mode: serverMode,
  children,
}: {
  mode: PaneMode;
  children: ReactNode;
}) {
  const mode = useShownPaneMode(serverMode);

  // 押した行の題を拾い、読み込み中の器に先に出す (docs/86 §4-18。noteHint.ts)。
  // 捕捉段で拾うのは、Link の onClick が遷移を始めるより前に置くため
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const hint = noteHintFromClick(event);
      if (hint !== null) {
        noteHintStore.set(hint);
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  const [detailItemId, setDetail] = useState<string | null>(null);
  const [autoItemId, setAuto] = useState<string | null>(null);

  const setDetailItemId = useCallback((itemId: string | null) => {
    setDetail(itemId);
  }, []);
  const setAutoItemId = useCallback((itemId: string | null) => {
    setAuto(itemId);
  }, []);

  const value = useMemo(
    () => ({
      mode,
      shownItemId: detailItemId ?? autoItemId,
      hasDetail: detailItemId !== null,
      detailItemId,
      setDetailItemId,
      setAutoItemId,
    }),
    [mode, detailItemId, autoItemId, setDetailItemId, setAutoItemId],
  );

  return (
    <PaneModeContext.Provider value={value}>{children}</PaneModeContext.Provider>
  );
}

// 一覧側のペインの根。data-panes … 選ばれている構成 (docs/86 §4-9)。
// globals.css が「3 / 2 なら幅に関係なくペインの積み方」を決めるのに使う。
// **サーバの値ではなく見せている構成を付ける** (docs/86 §4-18) — 押した瞬間に
// 器の積み方を変えるため
export function ResultsPaneRoot({ children }: { children: ReactNode }) {
  const { mode } = usePaneMode();
  return (
    <div data-results-pane data-panes={mode} className="space-y-2">
      {children}
    </div>
  );
}

// フォルダーペイン (3 ペインだけ)。中身はサーバが描くので、3 へ切り替えた
// ときは描き直しが届いてから出る。**3 から外したときはその場で引っ込める** —
// 居残ると一覧の左がペインの幅だけ空いたままになる (globals.css の body:has)
export function FolderPaneGate({ children }: { children: ReactNode }) {
  const { mode } = usePaneMode();
  return showsFolderPane(mode) ? children : null;
}
