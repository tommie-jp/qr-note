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
import { attachmentUrl } from "@/lib/images/memoImages";
import { notePaneLayout } from "@/lib/prefs/paneMode";
import {
  neighborTarget,
  sameTarget,
  type ViewerTarget,
} from "@/lib/images/viewerNav";
import { ImageViewerOverlay } from "./ImageViewerOverlay";
import { ImageViewerPane } from "./ImageViewerPane";
import { useEscapeKey } from "../modal/useEscapeKey";
import { requestLoadMore } from "../search/loadMore";

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

// 残りがこの枚数以下になったら次のページを先読みする (末尾で待たせない)。
// 1 ページは 20 件なので、半ページ手前で頼めば → を押し続けても追いつかない
const PREFETCH_REMAINING = 10;
// 出している画像の前後で、原寸を先に取っておく枚数 (送った瞬間に原寸が出る)
const PRELOAD_AHEAD = 2;
const PRELOAD_BEHIND = 1;
// 末尾で → を押してから、次のページの画像が出るのを待つ上限 (ms)
const LOAD_MORE_WAIT_MS = 15_000;

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
  // 開いたときに利用者が選んでいたノート (横取りスロット。自動の先頭ノートは
  // 数えない)。これが変わったら (一覧の題を押した・「ノートを開く」)
  // 画像は用済みとして捨てる
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
  const { mode, detailItemId } = usePaneMode();
  const [opened, setOpened] = useState<Opened | null>(null);
  // 選んだノートが変わったら用済み。描画中に捨てる (React の
  // 「props の変化で state を直す」型) — 隠すだけにすると、前のノートへ
  // 戻った (戻る・題を押し直す) 瞬間に閉じたはずの画像が蘇る
  if (opened !== null && opened.openedFor !== detailItemId) {
    setOpened(null);
  }
  const visible = opened !== null && opened.openedFor === detailItemId ? opened : null;
  const current = visible?.target ?? null;
  const asOverlay =
    overlayOnly || visible?.fullscreen === true || notePaneLayout(mode) === "fullscreen";

  // 末尾で → を押し、次のページの読み込みを待っている間 true。
  // 読み込まれて画像が増えたら、その先頭へそのまま送る (下の effect)
  const [awaitingMore, setAwaitingMore] = useState(false);

  // 開く・閉じる・送るたびに待ちは解く。残すと、閉じて別の画像を開いた後に
  // 遅れて届いたページで勝手に送られる
  const open = useCallback(
    (target: ViewerTarget) => {
      setAwaitingMore(false);
      setOpened({ target, openedFor: detailItemId, fullscreen: false });
    },
    [detailItemId],
  );
  const close = useCallback(() => {
    setAwaitingMore(false);
    setOpened(null);
  }, []);
  const showFullscreen = useCallback(
    () => setOpened((prev) => (prev ? { ...prev, fullscreen: true } : prev)),
    [],
  );

  // 送った先を出し、一覧の見える所まで寄せる — ペインの上で送っていても、
  // いまどれを見ているかが一覧の印で追える
  const showTarget = useCallback(
    (next: ViewerTarget, openers: HTMLElement[], targets: ViewerTarget[]) => {
      setOpened((prev) => (prev ? { ...prev, target: next } : prev));
      openers[targets.findIndex((t) => sameTarget(t, next))]?.scrollIntoView({
        block: "nearest",
      });
    },
    [],
  );

  // 前後へ送る。並びは押した瞬間の画面から拾い直す (送っている間に次の
  // ページが継ぎ足されても、その分まで届く)。
  //
  // 次のページは**ビューアから直接頼む** (requestLoadMore)。一覧の末尾の
  // 目印はスクロールで画面に入ったときにしか読まないが、2 / 3 ペインの
  // 内側スクロールでは → で末尾の画像まで寄せても目印が器の外に隠れた
  // ままで、最後の画像で止まっていた (loadMore.ts)。末尾に近づいたら
  // 先読みし (下の effect)、末尾で押されたら読み込みを待ってから送る
  const step = useCallback(
    (dir: -1 | 1) => {
      if (current === null) {
        return;
      }
      setAwaitingMore(false);
      const openers = openersInPage();
      const targets = openers.map(targetOf);
      const next = neighborTarget(targets, current, dir);
      if (next === null) {
        if (dir === 1 && requestLoadMore()) {
          setAwaitingMore(true);
        }
        return;
      }
      showTarget(next, openers, targets);
    },
    [current, showTarget],
  );

  // 読み込みを待つ。一覧の DOM が変わるたびに次の画像を探し、見つかれば送る。
  // 読み込んだページに画像が 1 枚も無ければ、続きがある限りもう 1 ページ頼む
  // (「次の画像」はその先にある)。続きが尽きるか、待ちすぎたらあきらめる
  useEffect(() => {
    if (!awaitingMore || current === null) {
      return;
    }
    const observer = new MutationObserver(() => {
      const openers = openersInPage();
      const targets = openers.map(targetOf);
      const next = neighborTarget(targets, current, 1);
      if (next !== null) {
        setAwaitingMore(false);
        showTarget(next, openers, targets);
      } else if (!requestLoadMore()) {
        setAwaitingMore(false);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => setAwaitingMore(false), LOAD_MORE_WAIT_MS);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [awaitingMore, current, showTarget]);

  // 先読み。前後の画像の原寸を先に取っておき (送ってから取りに行くと、
  // サムネの引き伸ばしから原寸に替わるまでの間が見える)、末尾に近ければ
  // 次のページを頼む。並びは今の画面から拾う
  useEffect(() => {
    if (current === null) {
      return;
    }
    const targets = openersInPage().map(targetOf);
    const index = targets.findIndex((t) => sameTarget(t, current));
    if (index === -1) {
      return;
    }
    const neighbors = [
      ...targets.slice(index + 1, index + 1 + PRELOAD_AHEAD),
      ...targets.slice(Math.max(0, index - PRELOAD_BEHIND), index),
    ];
    for (const t of neighbors) {
      new Image().src = attachmentUrl(t.name);
    }
    // 末尾に近ければ次のページも頼む。送ったときだけでなく、末尾近くの
    // 画像を押して開いたときにも効く
    if (targets.length - index <= PREFETCH_REMAINING) {
      requestLoadMore();
    }
  }, [current]);

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
