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
import { useSlideshowInterval } from "@/lib/prefs/slideshowInterval";
import {
  neighborTarget,
  planStep,
  sameTarget,
  type StepPlan,
  type ViewerTarget,
} from "@/lib/images/viewerNav";
import { ImageViewerOverlay } from "./ImageViewerOverlay";
import { ImageViewerPane } from "./ImageViewerPane";
import { useScreenWakeLock } from "./useScreenWakeLock";
import { useEscapeKey } from "../modal/useEscapeKey";
import { hasMoreResults, requestLoadMore } from "../search/loadMore";

interface ImageViewerState {
  current: ViewerTarget | null;
  open: (target: ViewerTarget) => void;
  // 一覧の先頭の画像から、全画面でスライドショーを始める (docs/117 §1)。
  // 押せる画像が 1 枚も無ければ何もせず false
  startSlideshow: () => boolean;
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
// 出している画像の前後で、原寸を先に取っておく枚数 (送った瞬間に原寸が出る)。
// スライドショー中は手で送るより速く進む (3 秒間隔で数 MB の写真が続く)
// ので、先を厚めに取る
const PRELOAD_AHEAD = 2;
const PRELOAD_AHEAD_PLAYING = 4;
const PRELOAD_BEHIND = 1;
// 末尾で → を押してから、次のページの画像が出るのを待つ上限 (ms)
const LOAD_MORE_WAIT_MS = 15_000;
// スライドショーで、原寸が読み終わるのを待つ上限 (ms)。弱い回線で要求が
// 返らないまま止まると、消灯も抑えたまま永遠に同じ 1 枚になる。過ぎたら
// サムネのまま次へ送る
const SETTLE_WAIT_MS = 15_000;

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
// ▶ (釦・Space) でスライドショーになり、全画面の覆いで一定の間隔で次へ送る
// (docs/117)。一覧の見出し行の「スライドショー」からは先頭の画像から始まる。
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
  // スライドショーの再生中か (docs/117)。再生中は必ず覆いで出す
  const [playing, setPlaying] = useState(false);
  // 原寸を読み終えた (読めなかった) 画像の名前。自動送りの間隔はここから数える
  const [settledName, setSettledName] = useState<string | null>(null);
  // 選んだノートが変わったら用済み。描画中に捨てる (React の
  // 「props の変化で state を直す」型) — 隠すだけにすると、前のノートへ
  // 戻った (戻る・題を押し直す) 瞬間に閉じたはずの画像が蘇る
  if (opened !== null && opened.openedFor !== detailItemId) {
    setOpened(null);
    setPlaying(false);
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
      setPlaying(false);
      setOpened({ target, openedFor: detailItemId, fullscreen: false });
    },
    [detailItemId],
  );
  const close = useCallback(() => {
    setAwaitingMore(false);
    setPlaying(false);
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

  // 1 枚送る。並びは送る瞬間の画面から拾い直す (送っている間に次の
  // ページが継ぎ足されても、その分まで届く)。手の ← → と自動送りが共有し、
  // どうなったか (planStep) を返す。
  //
  // 次のページは**ビューアから直接頼む** (requestLoadMore)。一覧の末尾の
  // 目印はスクロールで画面に入ったときにしか読まないが、2 / 3 ペインの
  // 内側スクロールでは → で末尾の画像まで寄せても目印が器の外に隠れた
  // ままで、最後の画像で止まっていた (loadMore.ts)。末尾に近づいたら
  // 先読みし (下の effect)、末尾で押されたら読み込みを待ってから送る
  const advance = useCallback(
    (dir: -1 | 1): StepPlan["kind"] | null => {
      if (current === null) {
        return null;
      }
      setAwaitingMore(false);
      const openers = openersInPage();
      const targets = openers.map(targetOf);
      const plan = planStep(targets, current, dir, hasMoreResults());
      if (plan.kind === "move") {
        showTarget(plan.target, openers, targets);
      } else if (plan.kind === "wait") {
        requestLoadMore();
        setAwaitingMore(true);
      }
      return plan.kind;
    },
    [current, showTarget],
  );

  // 手で送る (釦・← →)。スライドショーは止める — 手で送ったのは
  // 「この 1 枚を見たい」意思なので、勝手に次へ行かない (docs/117 §3)
  const step = useCallback(
    (dir: -1 | 1) => {
      setPlaying(false);
      advance(dir);
    },
    [advance],
  );

  // 再生 / 一時停止。始めるときは全画面にする (ペインのまま流すと、狭い
  // ペインで眺めることになる)。止めても全画面のまま — 止めた瞬間に
  // ペインへ戻ると絵が跳ねる。再生はいま出ている 1 枚から始める
  const togglePlay = useCallback(() => {
    // 止めるときは次のページの待ちも解く。残すと、届いた瞬間に止めたはずの
    // スライドショーが 1 枚進む
    setAwaitingMore(false);
    if (playing) {
      setPlaying(false);
      return;
    }
    showFullscreen();
    setPlaying(true);
  }, [playing, showFullscreen]);

  // 自動送りが末尾 (続きのページも尽きた所) に着いたら、一覧の先頭へ戻って
  // 流し続ける (docs/117 §2)。手の ← → は今までどおり端で止まる
  // (docs/116 §4) — 回り込むのは眺めている自動送りのときだけ
  const loopToFirst = useCallback(() => {
    const openers = openersInPage();
    const targets = openers.map(targetOf);
    if (targets.length === 0) {
      setPlaying(false);
      return;
    }
    showTarget(targets[0], openers, targets);
  }, [showTarget]);

  const startSlideshow = useCallback(() => {
    const openers = openersInPage();
    if (openers.length === 0) {
      return false;
    }
    openers[0].scrollIntoView({ block: "nearest" });
    // 押した釦 (一覧の見出し行) に焦点を残すと、Space が釦を押し直して
    // 先頭から始め直してしまう
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setAwaitingMore(false);
    setOpened({
      target: targetOf(openers[0]),
      openedFor: detailItemId,
      fullscreen: true,
    });
    setPlaying(true);
    return true;
  }, [detailItemId]);

  // 読み込みを待つ。一覧の DOM が変わるたびに次の画像を探し、見つかれば送る。
  // 読み込んだページに画像が 1 枚も無ければ、続きがある限りもう 1 ページ頼む
  // (「次の画像」はその先にある)。続きが尽きるか、待ちすぎたらあきらめる
  useEffect(() => {
    if (!awaitingMore || current === null) {
      return;
    }
    // あきらめたとき、スライドショー中ならそこが末尾なので先頭へ戻る
    const giveUp = () => {
      setAwaitingMore(false);
      if (playing) {
        loopToFirst();
      }
    };
    const observer = new MutationObserver(() => {
      const openers = openersInPage();
      const targets = openers.map(targetOf);
      const next = neighborTarget(targets, current, 1);
      if (next !== null) {
        setAwaitingMore(false);
        showTarget(next, openers, targets);
      } else if (!requestLoadMore()) {
        giveUp();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(giveUp, LOAD_MORE_WAIT_MS);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [awaitingMore, current, playing, showTarget, loopToFirst]);

  // 自動送り (docs/117 §2)。原寸を読み終えてから間隔を数える — 時計だけで
  // 進めると、通信が遅いときサムネの引き伸ばしのまま次へ行ってしまう。
  // 読み終わらないまま SETTLE_WAIT_MS 経ったらあきらめて送る。
  // 次のページを待っている間は数えない (届いて送られたら、その 1 枚から数え直す)。
  // 間隔を変えたら、いま出ている 1 枚の時計もその場で掛け直す
  const intervalSec = useSlideshowInterval();
  const settled = current !== null && settledName === current.name;
  useEffect(() => {
    if (!playing || awaitingMore) {
      return;
    }
    const timer = setTimeout(
      () => {
        if (advance(1) === "end") {
          loopToFirst();
        }
      },
      settled ? intervalSec * 1000 : SETTLE_WAIT_MS,
    );
    return () => clearTimeout(timer);
  }, [playing, settled, awaitingMore, current, intervalSec, advance, loopToFirst]);

  useScreenWakeLock(playing && current !== null);

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
    const ahead = playing ? PRELOAD_AHEAD_PLAYING : PRELOAD_AHEAD;
    const neighbors = [
      ...targets.slice(index + 1, index + 1 + ahead),
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
  }, [current, playing]);

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
      } else if (event.key === " " && asOverlay) {
        // Space で再生 / 一時停止 (動画の再生と同じ手)。全画面の覆いの
        // ときだけ — ペインのときは一覧の Space (スクロール) を奪わない。
        // 焦点のある釦を押させない — 一覧の画像の釦なら、開き直して再生が止まる
        event.preventDefault();
        if (!event.repeat) {
          togglePlay();
        }
      }
    };
    // 釦は Space を離したときに押される。keydown を止めても押されるブラウザが
    // あるので、離す側も止める
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " " && asOverlay && acceptsArrowKeys(event.target)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [asOverlay, current, step, togglePlay]);

  // Esc は覆いのときだけ。ペインは Esc を持たない流儀 (docs/86 §2) に合わせる
  useEscapeKey(close, current !== null && asOverlay);

  const value = useMemo(
    () => ({ current, open, startSlideshow }),
    [current, open, startSlideshow],
  );

  return (
    <ImageViewerContext.Provider value={value}>
      {children}
      {current !== null &&
        (asOverlay ? (
          <ImageViewerOverlay
            target={current}
            onClose={close}
            onStep={step}
            playing={playing}
            onTogglePlay={togglePlay}
            onSettled={setSettledName}
          />
        ) : (
          <ImageViewerPane
            target={current}
            onClose={close}
            onStep={step}
            onFullscreen={showFullscreen}
            onTogglePlay={togglePlay}
            onSettled={setSettledName}
          />
        ))}
    </ImageViewerContext.Provider>
  );
}
