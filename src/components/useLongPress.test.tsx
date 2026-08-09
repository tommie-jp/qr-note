import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { LONG_PRESS_MS, type PressPoint } from "@/lib/longPress";
import { useLongPress, type LongPressOptions } from "./useLongPress";

type Press = ReturnType<typeof useLongPress>;

// この土台に jsdom は無い (vitest.config.ts の environment: 'node')。
// フックを静的描画の中で 1 度だけ呼び、返ってきたハンドラを外へ取り出して
// 直に叩く。押下 → contextmenu → click の順番は自分で並べる — ブラウザが
// どの順で投げてくるかがこのフックの争点なので、順番こそ書き分けたい。
//
// useRef は描画のたびに同じ器を返すので、1 度描画したハンドラの束を
// 押下 1 回ぶんの流れとして使い回せる (useEffect は SSR では走らない = 後始末だけ)
function pressOf(
  onLongPress: (point: PressPoint) => void,
  options?: LongPressOptions,
): Press {
  const captured: Press[] = [];
  function Probe() {
    captured.push(useLongPress(onLongPress, options));
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return captured[0];
}

// ハンドラだけ要るテストの近道 (大半はこちら)
const handlersOf = (
  onLongPress: (point: PressPoint) => void,
  options?: LongPressOptions,
) => pressOf(onLongPress, options).handlers;

const pointerDown = (button = 0) =>
  ({ button, clientX: 10, clientY: 10 }) as React.PointerEvent;

const mouseEvent = () => {
  const event = {
    clientX: 10,
    clientY: 10,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return { event: event as unknown as React.MouseEvent, spy: event };
};

// キーには座標が無く、フックは押した部品の寸法から中心を引く
const keyEvent = (key: string) =>
  ({
    key,
    preventDefault: vi.fn(),
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 40 }),
    },
  }) as unknown as React.KeyboardEvent;

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

// 長押しでメニューを開く位置は、押した指の座標で決まる
// (docs/66-行アクション計画.md §5-3)。0.5 秒のあいだに ref が書き換わっても、
// 開くのは**その押下の**位置でなければならない
test("成立した長押しには押し始めの座標を渡す", () => {
  vi.useFakeTimers();
  const onLongPress = vi.fn();
  const handlers = handlersOf(onLongPress);

  handlers.onPointerDown(pointerDown());
  vi.advanceTimersByTime(LONG_PRESS_MS);

  expect(onLongPress).toHaveBeenCalledWith({ x: 10, y: 10 });
});

// 検索結果の行は横スワイプも持つ。取り消しの閾値がスワイプ 8px・長押し 10px と
// 2px 重なっており、その隙間で指を止めると引き出しとメニューが同時に出る。
// スワイプ側が「横と確定した」時点で外から捨てられる必要がある (docs/66 §5-1)
test("外から cancel すると待機中の長押しは成立しない", () => {
  vi.useFakeTimers();
  const onLongPress = vi.fn();
  const press = pressOf(onLongPress);

  press.handlers.onPointerDown(pointerDown());
  press.cancel();
  vi.advanceTimersByTime(LONG_PRESS_MS);

  expect(onLongPress).not.toHaveBeenCalled();
  expect(press.handlers.onClick(mouseEvent().event)).toBe(false);
});

// 検索結果の行はリンクなので、右クリックの「URL をコピー」を奪ってはいけない
// (docs/66 §5-2)。PC には代わりにホバーのボタン列がある
test('rightClick: "native" は PC の右クリックをブラウザに渡す', () => {
  const onLongPress = vi.fn();
  const handlers = handlersOf(onLongPress, { rightClick: "native" });

  const { event, spy } = mouseEvent();
  handlers.onContextMenu(event);

  expect(onLongPress).not.toHaveBeenCalled();
  expect(spy.preventDefault).not.toHaveBeenCalled();
});

// Android の長押しは contextmenu として届く。こちらは既定のメニューが
// 長押しメニューに重なるだけなので、"native" でも奪う
test('rightClick: "native" でも押している最中の contextmenu は長押しとして扱う', () => {
  vi.useFakeTimers();
  const onLongPress = vi.fn();
  const handlers = handlersOf(onLongPress, { rightClick: "native" });

  handlers.onPointerDown(pointerDown());
  const { event, spy } = mouseEvent();
  handlers.onContextMenu(event);

  expect(onLongPress).toHaveBeenCalledTimes(1);
  expect(spy.preventDefault).toHaveBeenCalled();
  // 指を離した click は握り潰す (メニューを出しただけでノートが開かない)
  expect(handlers.onClick(mouseEvent().event)).toBe(true);
});
