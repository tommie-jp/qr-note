"use client";

import { startTransition, useRef, useState, useSyncExternalStore } from "react";
import { navigate, refreshServerView } from "@/lib/client/navigation";
import {
  BOTTOM_BAR_FALLBACK_PX,
  PANE_SIZES,
  clampPaneSize,
  livePaneSizeLimit,
  paneCollapse,
  paneHideByDoubleClick,
  paneSizeValue,
  rawPaneSizeFromPointer,
  type PaneCollapse,
  type PaneKind,
} from "@/lib/prefs/paneSize";
import { switchPaneMode } from "@/components/panes/switchPaneMode";
import { listHrefFromItemUrl, notifyPreviewPaneHidden } from "@/components/panes/previewPaneHidden";
import { allowsSinglePane } from "@/modules/registry";
import {
  TAB_LENGTH_REM,
  setLiveTabPosition,
  setTabPosition,
  tabFraction,
  tabOffsetCss,
  useTabPosition,
} from "@/components/panes/paneTabPosition";

// 境界そのものの置き方。**ポインタ → 寸法の計算 (prefs/paneSize.ts) と対**で、
// どちらか片方だけ直すと掴む場所と動く量がずれる。
//
// 掴む帯は 8px 取り、境界の上に半分ずつ跨がせる (translate) —
// 線と同じ 1px では狙えないが、太い帯を見せると枠が二重に見える。
// z-20 … ペイン (z-10) より上。ヘッダー (z-20) とは場所が重ならない。
// touch-none … 指でなぞったときに画面ごとスクロールさせない。
// 見た目は普段は透明で、触れている間だけ色を出す (常時見える線は枠が担う)。
const HANDLE_CLASS: Record<PaneKind, string> = {
  // フォルダーの境界はペインと同じ寿命 (3 ペインのときだけ描かれる) なので、
  // 幅では畳まない (docs/86 §4-9)
  folder:
    "fixed top-[var(--header-h)] bottom-[var(--bottom-bar-h)] left-[var(--folder-pane-w)] z-20 m-0 block w-2 -translate-x-1/2 cursor-col-resize touch-none",
  // 左端をフォルダーペインの右へ寄せるのは globals.css (ペインが出ている
  // 構成のときだけ効かせたいので :has で見る)
  // m-0 … 境界の帯もペインと同じ理由で親の余白を打ち消す (docs/86 §4-12)
  preview:
    "fixed inset-x-0 m-0 bottom-[calc(var(--bottom-bar-h)+var(--keyboard-inset,0px)+var(--preview-pane-h))] z-20 h-2 translate-y-1/2 cursor-row-resize touch-none",
};

// 掴む帯そのものは透明のまま。**境界の線は中の 2px が描く** (docs/86 §4-10) —
// 帯 (8px) を塗ると太い色帯になって、ペインの枠と二重に見える。
// 触れている間だけ帯を薄く色付けて「掴める場所」を示す
// 動かしている間は色を付けない (普段の境界のまま。ペインの継ぎ目が動いて見える)
const HANDLE_SKIN =
  "group flex bg-transparent transition-colors focus-visible:bg-blue-400/40 focus-visible:outline-none";
const HANDLE_SKIN_IDLE = "hover:bg-blue-400/30";

// 境界の線。**濃いめのグレイで常に見せる** — ペインの継ぎ目が判らないと、
// どこを掴めば動かせるのかも判らない。掴んでいる間は青にして、いま動かして
// いる境界がどれか判るようにする (帯の色付けと対)
const HANDLE_LINE: Record<PaneKind, string> = {
  folder: "m-auto h-full w-0.5",
  preview: "m-auto h-0.5 w-full",
};

// 境界のつまみ (タブ)。8px の帯だけでは指でも マウスでも狙いにくいので、
// 線の上に掴みやすい大きさのタブを重ねる。帯の子なので、押せば帯の
// ドラッグ・ダブルクリックがそのまま働く (イベントは帯へ浮かぶ)。
// 帯から両側へはみ出して、ペインの端に少し重なる (z-20 で上に出る)。
// 境界に沿った位置は端末ごとに覚え、タブを掴んで境界に沿って動かせる
// (docs/86 §4-21。縦の境界は上下、横の境界は左右)。長さ (h-12 / w-12) は TAB_LENGTH_REM と対
export const HANDLE_TAB: Record<PaneKind, { shape: string; glyph: string }> = {
  folder: { shape: "h-12 w-5 text-base", glyph: "︙" },
  preview: { shape: "h-5 w-12 text-base", glyph: "⋯" },
};

// 指で触れる範囲 (docs/86 §4-26)。タブの見た目 (幅 20px) のままでは iPhone で狙えないので、
// 透明な ::before で細い向きを 44px (iOS の標準の的) まで広げる。見た目は変えない。
// 疑似要素はタブの一部として当たるので、押せば帯のドラッグがそのまま働く
const HANDLE_TAB_HIT: Record<PaneKind, string> = {
  folder: "before:absolute before:inset-y-0 before:-inset-x-3",
  preview: "before:absolute before:inset-x-0 before:-inset-y-3",
};

// 帯の中のタブの置き方 (境界の線の上に中心を載せる。沿った向きの位置は tabStyle)
const HANDLE_TAB_PLACE: Record<PaneKind, string> = {
  folder: "left-1/2 -translate-x-1/2",
  preview: "top-1/2 -translate-y-1/2",
};

export const HANDLE_TAB_SKIN =
  "flex items-center justify-center rounded border border-gray-400 bg-gray-100 leading-none text-gray-600 shadow-sm transition-colors group-hover:border-blue-500 group-hover:bg-blue-50 group-hover:text-blue-700 group-active:bg-blue-100";

// 境界に沿ったタブの位置 (帯の中で。帯の長さからタブの長さを引いた範囲に割合を掛ける)
function tabStyle(kind: PaneKind, fraction: number): React.CSSProperties {
  const offset = tabOffsetCss(fraction, "100%");
  return kind === "folder" ? { top: offset } : { left: offset };
}

// 引き切って「離すと隠す」位置まで来ている間のタブ (docs/86 §4-19)
const HANDLE_TAB_COLLAPSE = "border-amber-600 bg-amber-100 text-amber-800";

// いまの構成 (ペインの根の data-panes)。境界はフォルダーペイン (構成の文脈の外) にも
// 描かれるので、文脈ではなく画面から読む
// いまの表示が 1 ペインを許すか (カレンダーは許さない。docs/86 §4-28)。押した時の URL で決める
function allowSingleNow(): boolean {
  return allowsSinglePane(new URLSearchParams(location.search));
}

function currentPaneMode(): string {
  return document.querySelector("[data-panes]")?.getAttribute("data-panes") ?? "";
}

// 一覧の器の上端 (上の一覧が何行残るかを測る起点)。見つからなければヘッダーの下
function resultsTopPx(): number {
  const box = document.querySelector("[data-results-scroll]")?.getBoundingClientRect();
  return box?.top ?? readCssPx("--header-h", 0);
}

// 境界の線の色。隠したペインの引き出し中の線 (CollapsedPaneTabs) もこれで描く
export const DIVIDER_LINE_COLOR = "bg-gray-400";
const HANDLE_LINE_SKIN = `${DIVIDER_LINE_COLOR} transition-colors`;
const HANDLE_LINE_SKIN_IDLE = "group-hover:bg-blue-500";

export function readCssPx(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

// 保存された寸法は「React の外にある状態」なので、useSyncExternalStore で
// 読む。サーバでは既定を返し、マウント後に保存値へ切り替わる
// (state を effect で上書きすると、その 1 往復で読み上げ値がちらつく)。
//
// memory … localStorage を塞いでいるブラウザ (iOS のプライベート閲覧など)
// の受け皿。覚えられないだけで、そのセッション中は動かした寸法を保つ
const memory = new Map<PaneKind, number>();
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function readStored(kind: PaneKind): number {
  const remembered = memory.get(kind);
  if (remembered !== undefined) {
    return remembered;
  }
  try {
    return clampPaneSize(kind, localStorage.getItem(PANE_SIZES[kind].storageKey));
  } catch {
    return PANE_SIZES[kind].default;
  }
}

// 寸法を当てて覚える。隠れたペインを端のタブから戻すとき (CollapsedPaneTabs) も使う
export function setPaneSize(kind: PaneKind, size: number): void {
  document.documentElement.style.setProperty(PANE_SIZES[kind].cssVar, paneSizeValue(kind, size));
  storePaneSize(kind, size);
}

// ヘッダーの下端 (px)。--header-h は calc の式なので数としては読めない
export function headerBottomPx(): number {
  return document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
}

function storePaneSize(kind: PaneKind, size: number): void {
  memory.set(kind, size);
  try {
    localStorage.setItem(PANE_SIZES[kind].storageKey, String(size));
  } catch {
    // 覚えられなくても寸法は変えられたので、ここでは何も出さない
    // (テキストサイズと同じ判断)
  }
  for (const onChange of listeners) {
    onChange();
  }
}

// 検索 3 ペインの境界 (docs/86 §4-2)。ドラッグと矢印キーでペインの寸法を
// 変え、localStorage に覚える。
//
// 動かすのは CSS 変数 1 つだけ。ペインの寸法・一覧の底上げ・広幅補正は
// もとから同じ変数を見ているので、ここは「変数を書き換える」しかしない。
// **React の state では動かさない** — 1 フレームごとに再描画すると、
// 一覧に数百行ある状態でドラッグが引っかかる。state は読み上げ (aria) と
// キー操作の起点のためだけに持つ。
// 境界は幅では畳まない (docs/86 §4-9)。ノートが全画面のときは呼ぶ側が描かない
export function PaneResizer({ kind }: { kind: PaneKind }) {
  const spec = PANE_SIZES[kind];
  // サーバは寸法を知らないので既定を返す。見た目が跳ねることはない —
  // 実際の寸法は <head> の先回りスクリプトが当て済みで、ここが追いつくのは
  // 読み上げ (aria) とキー操作の起点だけ
  const size = useSyncExternalStore(
    subscribe,
    () => readStored(kind),
    () => spec.default,
  );
  // ドラッグ中の現在値。1 フレームごとに state を更新すると、一覧に数百行
  // ある状態で引っかかるので、動かしている間は ref と CSS 変数だけで進める
  const sizeRef = useRef<number>(spec.default);
  const [dragging, setDragging] = useState(false);
  // 掴んだときの寸法 (引き切って隠したら、ここへ戻してから構成を変える)
  const startRef = useRef<number>(spec.default);
  // 引き切っていま離すと隠すなら、その中身。ドラッグ中だけ
  const [collapse, setCollapse] = useState<PaneCollapse | null>(null);
  // 境界に沿ったタブの位置。動かしている間も共有の控えに流す (重なった境界のタブも動く)
  const tabPosition = useTabPosition(kind);
  // 動かしている間の最後の位置 (離したら覚える)
  const liveTabRef = useRef<number | null>(null);
  // タブを掴んでドラッグしているか (帯の他の所を掴んだときはタブを動かさない)
  const grabbedTabRef = useRef(false);

  const apply = (next: number) => {
    sizeRef.current = next;
    document.documentElement.style.setProperty(
      spec.cssVar,
      paneSizeValue(kind, next),
    );
  };

  const commit = (next: number) => {
    apply(next);
    storePaneSize(kind, next);
  };

  const moveTo = (event: React.PointerEvent) => {
    const geometry = {
      clientX: event.clientX,
      clientY: event.clientY,
      rootFontSizePx: readCssPx("font-size", 16),
      viewportHeightPx: window.innerHeight,
      bottomBarPx: readCssPx("--bottom-bar-h", BOTTOM_BAR_FALLBACK_PX),
    };
    // ドラッグ中は 0 から画面の端まで指について動かす (docs/86 §4-21)。
    // 上下限に寄せるのは離したとき
    const limit = livePaneSizeLimit(kind, {
      widthPx: window.innerWidth,
      heightPx: window.innerHeight,
      rootFontSizePx: geometry.rootFontSizePx,
      bottomBarPx: geometry.bottomBarPx,
      headerPx: headerBottomPx(),
    });
    apply(Math.min(limit, Math.max(0, rawPaneSizeFromPointer(kind, geometry))));
    if (grabbedTabRef.current) {
      const band = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const tabPx = TAB_LENGTH_REM * geometry.rootFontSizePx;
      const fraction =
        kind === "folder"
          ? tabFraction(event.clientY, band.top, band.height, tabPx)
          : tabFraction(event.clientX, band.left, band.width, tabPx);
      liveTabRef.current = fraction;
      setLiveTabPosition(kind, fraction);
    }
    const next = paneCollapse(
      kind,
      { ...geometry, resultsTopPx: resultsTopPx() },
      currentPaneMode(),
      allowSingleNow(),
    );
    if (next?.hide !== collapse?.hide) {
      setCollapse(next);
    }
  };

  // 引き切って離した: 寸法は掴む前に戻し (次にペインを出したとき端に張り付かない)、
  // 狭くなった側を隠して構成を 1 つ減らす (docs/86 §4-19)
  const hidePane = (target: PaneCollapse) => {
    commit(startRef.current);
    if (target.hide === "preview") {
      // 下のペインの中身を閉じる。ノートは URL が正なので一覧の URL へ戻す
      notifyPreviewPaneHidden();
      const listHref = listHrefFromItemUrl(new URL(location.href));
      if (listHref !== null) {
        navigate(listHref, { replace: true });
      }
    }
    // 構成を変えない隠し方 (カレンダーで下を閉じるだけ) は切り替えない
    if (target.mode === currentPaneMode()) {
      return;
    }
    void switchPaneMode(target.mode, () => {
      startTransition(refreshServerView);
    });
  };

  // ドラッグ中は本文の選択とカーソルの点滅を止める。帯から指が外れても
  // 掴んだままにするのは setPointerCapture の役目
  const endDrag = (event: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    setCollapse(null);
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
    if (liveTabRef.current !== null) {
      setTabPosition(kind, liveTabRef.current);
      liveTabRef.current = null;
    }
    grabbedTabRef.current = false;
    // 取り消し (pointercancel) では隠さない
    if (collapse !== null && event.type === "pointerup") {
      hidePane(collapse);
      return;
    }
    // ドラッグ中は上下限の外まで動かしているので、離したら寄せる
    commit(clampPaneSize(kind, sizeRef.current));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // 矢印の向きは境界の動く向きに合わせる。プレビューは上へ引くほど
    // 広くなる (境界が上がる) ので ↑ が +
    const byKey: Record<string, number | undefined> =
      spec.orientation === "vertical"
        ? { ArrowLeft: -spec.step, ArrowRight: spec.step }
        : { ArrowUp: spec.step, ArrowDown: -spec.step };
    const delta = byKey[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      commit(clampPaneSize(kind, size + delta));
      return;
    }
    // Home / End は端まで、Enter は既定へ
    const jump =
      event.key === "Home"
        ? spec.min
        : event.key === "End"
          ? spec.max
          : event.key === "Enter"
            ? spec.default
            : null;
    if (jump !== null) {
      event.preventDefault();
      commit(jump);
    }
  };

  return (
    <div
      // separator に tabindex を付けると「動かせる境界」として読み上げられる
      // (WAI-ARIA の window splitter)。値は保存されている寸法そのもの
      role="separator"
      aria-orientation={spec.orientation}
      aria-label={spec.label}
      aria-valuenow={size}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      tabIndex={0}
      title={`${spec.label} (ドラッグか矢印キーで調整、Enter で既定に戻す。ダブルクリックか端まで引き切って離すとペインを隠す)`}
      data-collapse={collapse?.hide}
      className={`${HANDLE_CLASS[kind]} ${HANDLE_SKIN} ${
        dragging ? "" : HANDLE_SKIN_IDLE
      }`}
      onPointerDown={(event) => {
        // 掴んだ瞬間は動かさない (押しただけで寸法が飛ばないように)。
        // 主ボタン以外は無視する
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        grabbedTabRef.current =
          event.target instanceof Element && event.target.closest("[data-pane-resizer-tab]") !== null;
        // 掴んだ時点の値から始める (ドラッグ中はここから ref だけで進む)
        sizeRef.current = size;
        startRef.current = size;
        setDragging(true);
        document.body.style.setProperty("user-select", "none");
        document.body.style.setProperty(
          "cursor",
          spec.orientation === "vertical" ? "col-resize" : "row-resize",
        );
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        moveTo(event);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // ダブルクリックでペインを隠す (docs/86 §4-19)。フォルダーの境界はフォルダー、
      // 一覧とノートの境界は下のペイン。隠すペインが無い構成では何もしない
      onDoubleClick={() => {
        const target = paneHideByDoubleClick(kind, currentPaneMode(), allowSingleNow());
        if (target !== null) {
          hidePane(target);
        }
      }}
      onKeyDown={onKeyDown}
    >
      <span
        aria-hidden
        className={`${HANDLE_LINE[kind]} ${HANDLE_LINE_SKIN} ${
          dragging ? "" : HANDLE_LINE_SKIN_IDLE
        }`}
      />
      <span
        aria-hidden
        data-pane-resizer-tab=""
        style={tabStyle(kind, tabPosition)}
        className={`absolute ${HANDLE_TAB_PLACE[kind]} ${HANDLE_TAB[kind].shape} ${HANDLE_TAB_SKIN} ${HANDLE_TAB_HIT[kind]} ${
          collapse !== null ? HANDLE_TAB_COLLAPSE : dragging ? "border-blue-600 bg-blue-100 text-blue-700" : ""
        }`}
      >
        {HANDLE_TAB[kind].glyph}
      </span>
    </div>
  );
}
