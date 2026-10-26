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
import { usePaneMode } from "@/components/panes/PaneModeProvider";
import { notePaneLayout } from "@/lib/prefs/paneMode";
import {
  neighborTarget,
  sameTarget,
  type ViewerTarget,
} from "@/lib/images/viewerNav";
import { ImageViewerOverlay } from "./ImageViewerOverlay";
import { ImageViewerPane } from "./ImageViewerPane";
import { useEscapeKey } from "../modal/useEscapeKey";

interface ImageViewerState {
  current: ViewerTarget | null;
  open: (target: ViewerTarget) => void;
}

const ImageViewerContext = createContext<ImageViewerState | null>(null);

// provider の外では null。押す口 (ViewerImageButton) は null なら素の画像に
// 戻り、今までどおりタイル・行のリンクがノートを開く
export function useImageViewer(): ImageViewerState | null {
  return useContext(ImageViewerContext);
}

// 一覧に並んでいる「押せる画像」を DOM の順で拾う (docs/116 §4)。
// 無限スクロールは読み込んだページごとに別の一覧を描くので、どれか 1 つの
// 一覧の props からは「次の 1 枚」が決まらない。画面に並んでいる順が
// そのまま利用者の見ている順なので、目印 (data-viewer-*) から組み立てる
const OPENER_SELECTOR = "[data-viewer-image]";

function openersInPage(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(OPENER_SELECTOR)];
}

function targetOf(el: HTMLElement): ViewerTarget {
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

function acceptsArrowKeys(target: EventTarget | null): boolean {
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

interface Opened {
  target: ViewerTarget;
  // 開いたときにノートのペインに出ていたノート。これが変わったら
  // (一覧の題を押した・「ノートを開く」) 画像は用済みとして捨てる
  openedFor: string | null;
  // ペインの構成でも全画面で見たいとき (ペインの「全画面」)
  fullscreen: boolean;
}

// 検索結果の画像を大きく見せるビューア (docs/116)。
//
//   1 ペイン・overlayOnly … 画面全体の覆い (ZoomableImage と同じ見た目)
//   2 / 3 ペイン          … ノートのペインの場所に画像だけを出し、
//                            ペインの高さに縦が全部収まるように縮める
//
// どちらも ← → (釦・キー) で一覧の前後の画像へ送れる。
// URL には載せない — 載せると送るたびに検索が走り直す (docs/86 §2 と同じ理由)。
// 再読み込みすればノートの表示に戻る、で足りる
export function ImageViewerProvider({
  overlayOnly = false,
  children,
}: {
  // ノートのペインが無い画面 (ゴミ箱) では常に覆いで出す
  overlayOnly?: boolean;
  children: ReactNode;
}) {
  const { mode, shownItemId } = usePaneMode();
  const [opened, setOpened] = useState<Opened | null>(null);
  // ペインに出ているノートが変わったら用済み。描画中に捨てる (React の
  // 「props の変化で state を直す」型) — 隠すだけにすると、前のノートへ
  // 戻った (戻る・題を押し直す) 瞬間に閉じたはずの画像が蘇る
  if (opened !== null && opened.openedFor !== shownItemId) {
    setOpened(null);
  }
  const visible = opened !== null && opened.openedFor === shownItemId ? opened : null;
  const current = visible?.target ?? null;
  const asOverlay =
    overlayOnly || visible?.fullscreen === true || notePaneLayout(mode) === "fullscreen";

  const open = useCallback(
    (target: ViewerTarget) =>
      setOpened({ target, openedFor: shownItemId, fullscreen: false }),
    [shownItemId],
  );
  const close = useCallback(() => setOpened(null), []);
  const showFullscreen = useCallback(
    () => setOpened((prev) => (prev ? { ...prev, fullscreen: true } : prev)),
    [],
  );

  // 前後へ送る。並びは押した瞬間の画面から拾い直す (送っている間に次の
  // ページが継ぎ足されても、その分まで届く)。送った先のタイル・行は
  // 一覧の見える所まで寄せる — ペインの上で送っていても、いまどれを
  // 見ているかが一覧の印で追える
  const step = useCallback(
    (dir: -1 | 1) => {
      if (current === null) {
        return;
      }
      const openers = openersInPage();
      const targets = openers.map(targetOf);
      const next = neighborTarget(targets, current, dir);
      if (next === null) {
        return;
      }
      setOpened((prev) => (prev ? { ...prev, target: next } : prev));
      openers[targets.findIndex((t) => sameTarget(t, next))]?.scrollIntoView({
        block: "nearest",
      });
    },
    [current],
  );

  useEffect(() => {
    if (current === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !acceptsArrowKeys(event.target)
      ) {
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        step(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, step]);

  // Esc は覆いのときだけ。ペインは Esc を持たない流儀 (docs/86 §2) に合わせる
  useEscapeKey(close, current !== null && asOverlay);

  const value = useMemo(() => ({ current, open }), [current, open]);

  return (
    <ImageViewerContext.Provider value={value}>
      {children}
      {current !== null &&
        (asOverlay ? (
          <ImageViewerOverlay
            target={current}
            onClose={close}
            onStep={step}
          />
        ) : (
          <ImageViewerPane
            target={current}
            onClose={close}
            onStep={step}
            onFullscreen={showFullscreen}
          />
        ))}
    </ImageViewerContext.Provider>
  );
}
