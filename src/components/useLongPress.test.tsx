import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { LONG_PRESS_MS } from "@/lib/longPress";
import { useLongPress } from "./useLongPress";

type Handlers = ReturnType<typeof useLongPress>;

// この土台に jsdom は無い (vitest.config.ts の environment: 'node')。
// フックを静的描画の中で 1 度だけ呼び、返ってきたハンドラを外へ取り出して
// 直に叩く。押下 → contextmenu → click の順番は自分で並べる — ブラウザが
// どの順で投げてくるかがこのフックの争点なので、順番こそ書き分けたい。
//
// useRef は描画のたびに同じ器を返すので、1 度描画したハンドラの束を
// 押下 1 回ぶんの流れとして使い回せる (useEffect は SSR では走らない = 後始末だけ)
function handlersOf(onLongPress: () => void): Handlers {
  const captured: Handlers[] = [];
  function Probe() {
    captured.push(useLongPress(onLongPress));
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return captured[0];
}

const pointerDown = (button = 0) =>
  ({ button, clientX: 10, clientY: 10 }) as React.PointerEvent;

const mouseEvent = () => {
  const event = {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return { event: event as unknown as React.MouseEvent, spy: event };
};

const keyEvent = (key: string) =>
  ({ key, preventDefault: vi.fn() }) as unknown as React.KeyboardEvent;

afterEach(() => {
  vi.useRealTimers();
});

// 長押しが成立したら、放した指の click は握り潰す。スロットはフォームの
// submit ボタンなので、通すと「メニューを出したのに表示モードも切り替わって
// いた」になる (docs/62 §3)
test("タイマーで成立した長押しは続く click を握り潰す", () => {
  vi.useFakeTimers();
  const onLongPress = vi.fn();
  const handlers = handlersOf(onLongPress);

  handlers.onPointerDown(pointerDown());
  vi.advanceTimersByTime(LONG_PRESS_MS);
  expect(onLongPress).toHaveBeenCalledTimes(1);

  const { event, spy } = mouseEvent();
  expect(handlers.onClick(event)).toBe(true);
  expect(spy.preventDefault).toHaveBeenCalled();
});

test("短いタップは握り潰さない (循環はそのまま通す)", () => {
  vi.useFakeTimers();
  const handlers = handlersOf(vi.fn());

  handlers.onPointerDown(pointerDown());
  handlers.onPointerUp();

  expect(handlers.onClick(mouseEvent().event)).toBe(false);
});

// Android Chrome は長押しの contextmenu をタイマーより**先に**投げてくる。
// このとき contextmenu 側が cancel() でタイマーを消すので、タイマーは
// もう fired を立てられない。放した指の click が「ただのタップ」と見なされ、
// dismissOrCycle が開いたばかりのメニューをその場で閉じていた
// (長押しが効かないように見える)
test("押している最中の contextmenu も続く click を握り潰す", () => {
  vi.useFakeTimers();
  const onLongPress = vi.fn();
  const handlers = handlersOf(onLongPress);

  handlers.onPointerDown(pointerDown());
  // タイマーより先に来る
  handlers.onContextMenu(mouseEvent().event);
  expect(onLongPress).toHaveBeenCalledTimes(1);

  const { event, spy } = mouseEvent();
  expect(handlers.onClick(event)).toBe(true);
  expect(spy.preventDefault).toHaveBeenCalled();
});

// 右クリックに続く click は無い。ここで握り潰す構えのまま待つと、次の活性化
// (フォーカスが残ったままの Enter / Space、読み上げソフトからの実行) を
// 食べてしまい、押しても何も起きないボタンになる
test("押していないときの contextmenu (右クリック) は次の活性化を握り潰さない", () => {
  const onLongPress = vi.fn();
  const handlers = handlersOf(onLongPress);

  handlers.onContextMenu(mouseEvent().event);
  expect(onLongPress).toHaveBeenCalledTimes(1);

  expect(handlers.onClick(mouseEvent().event)).toBe(false);
});

// 右クリックの押下は onPointerDown が素通しする (button 2)。その後に
// contextmenu が来ても「押している最中」とは見なさない
test("右ボタンの押下では長押しのタイマーを仕掛けない", () => {
  vi.useFakeTimers();
  const onLongPress = vi.fn();
  const handlers = handlersOf(onLongPress);

  handlers.onPointerDown(pointerDown(2));
  vi.advanceTimersByTime(LONG_PRESS_MS);
  expect(onLongPress).not.toHaveBeenCalled();

  handlers.onContextMenu(mouseEvent().event);
  expect(handlers.onClick(mouseEvent().event)).toBe(false);
});

// 指が離れた後の contextmenu は右クリックと同じ扱いでよい。click は
// もう来ない (来るとしても押下からやり直しになる)
test("指を離した後の contextmenu は握り潰さない", () => {
  vi.useFakeTimers();
  const handlers = handlersOf(vi.fn());

  handlers.onPointerDown(pointerDown());
  handlers.onPointerUp();
  handlers.onContextMenu(mouseEvent().event);

  expect(handlers.onClick(mouseEvent().event)).toBe(false);
});

// 長押しでメニューが開いた直後、そのまま指をボタンの外へ滑らせて離す
// (開いたメニューへ向かう自然な動き)。この枠に click は来ないので、
// 握り潰す構えを残すと次の活性化を食べてしまう
test("長押しの後に枠の外で離したら、握り潰す構えを残さない", () => {
  vi.useFakeTimers();
  const onLongPress = vi.fn();
  const handlers = handlersOf(onLongPress);

  handlers.onPointerDown(pointerDown());
  vi.advanceTimersByTime(LONG_PRESS_MS);
  expect(onLongPress).toHaveBeenCalledTimes(1);
  handlers.onPointerLeave();

  expect(handlers.onClick(mouseEvent().event)).toBe(false);
});

test("押下が取り消されたときも構えを残さない", () => {
  vi.useFakeTimers();
  const handlers = handlersOf(vi.fn());

  handlers.onPointerDown(pointerDown());
  vi.advanceTimersByTime(LONG_PRESS_MS);
  handlers.onPointerCancel();

  expect(handlers.onClick(mouseEvent().event)).toBe(false);
});

// キーボードからの活性化には押下 (onPointerDown) が先行しないので、構えを
// 倒す機会がここにしかない。**残っていると押しても何も起きないボタンになり、
// 原因も見えない** — ボタンはフォーカスを持ったままなので、長押しの後に
// Enter を押した人がこれを踏む
test("キーボードからの活性化は、構えが残っていても通す", () => {
  vi.useFakeTimers();
  const handlers = handlersOf(vi.fn());

  // Android Chrome は contextmenu の後の click を投げてこないことがあり、
  // その場合は構えが立ったまま残る
  handlers.onPointerDown(pointerDown());
  handlers.onContextMenu(mouseEvent().event);

  handlers.onKeyDown(keyEvent("Enter"));
  expect(handlers.onClick(mouseEvent().event)).toBe(false);
});

// ↑ ↓ はメニューを開く合図。こちらは click を伴わないので、開いた後に
// 構えが残っていないことだけ確かめる
test("↑ でメニューを開いても構えは残らない", () => {
  const onLongPress = vi.fn();
  const handlers = handlersOf(onLongPress);

  handlers.onKeyDown(keyEvent("ArrowUp"));
  expect(onLongPress).toHaveBeenCalledTimes(1);
  expect(handlers.onClick(mouseEvent().event)).toBe(false);
});
