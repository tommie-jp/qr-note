"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { unstable_rethrow } from "next/navigation";
import type { MenuPoint } from "@/lib/rowActionMenu";
import {
  SWIPE_BUTTON_WIDTH,
  beginSwipe,
  initialSwipeState,
  moveSwipe,
  resolveOpen,
  settleSwipe,
  type SwipeState,
} from "@/lib/swipeRow";
import { TrashIcon } from "./MenuIcons";
import { RowActionMenu } from "./RowActionMenu";
import {
  RowActionButtons,
  ROW_ACTION_SELECTOR,
  type RowAction,
} from "./RowActions";
import { useLongPress } from "./useLongPress";

interface SwipeToTrashRowProps {
  itemNo: string;
  // ノートをゴミ箱へ入れるサーバーアクション (BulkTagToolbar と同じ trashItemsAction)。
  trashAction: (formData: FormData) => void | Promise<void>;
  // この行が開いているか。「開くのは常に 1 行だけ」を親 (ItemList) が持つ。
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  // 小 … 削除で高さ 0 へ潰す。大 … 高さが可変・グリッドで隣に揃うので
  // 潰さずフェードで消す (docs/43 §9-1)。
  view: "compact" | "card";
  // カードの枠 (h-full rounded border bg-white) は ItemRow が持ち、li に足す
  // クラスとして渡す。見た目の定義を 2 か所に散らさない (docs/43 §9-2)。
  liClassName?: string;
  // 中身は ItemRow が組み立てた 1 行 / 1 カードぶん。
  children: ReactNode;
}

// ノートの 1 行 / 1 カードに操作を付けるラッパー。
//
//   左スワイプ … 右端の赤い「削除」ボタンを露出させる (docs/43-スワイプ削除計画.md)。
//   ホバー     … 右端にアイコンボタン列を出す。PC 用 (docs/66-行アクション計画.md §4)。
//   長押し     … 指の近くに操作メニューを出す。スマホ用 (docs/66 §5)。
//
// 判定ロジックは lib/swipeRow.ts と lib/longPress.ts の純関数に任せ、ここは
// pointer と DOM/React state の橋渡しに徹する。
//
//   背面 … 右端に固定した赤い「削除」ボタン。
//   前面 … 既存の行 (bg-white)。translateX で左へずれてボタンを露出させる。
//
// **行アクションの一覧 (actions) をここで組む。** 送信中・失敗の状態を持てるのが
// この階層だけなので、実行する手と一覧を同じ所に置く。今後ピン留めなどを足す
// ときは actions に 1 つ足せば、ホバーの列とメニューの両方に同時に現れる。
export function SwipeToTrashRow({
  itemNo,
  trashAction,
  isOpen,
  onOpenChange,
  view,
  liClassName = "",
  children,
}: SwipeToTrashRowProps) {
  // 動きの真実は ref に持つ (pointer ハンドラが前回値を同期に読めるように)。
  // ref は描画では触らず (react-hooks/refs)、offset / dragging を state へ写す。
  const stateRef = useRef<SwipeState>(initialSwipeState(isOpen));
  const [offset, setOffset] = useState(() =>
    isOpen ? -SWIPE_BUTTON_WIDTH : 0,
  );
  const [dragging, setDragging] = useState(false);
  // ドラッグ直後に飛んでくる click を 1 回だけ握りつぶす印
  // (stretched link がノートを開いてしまうのを防ぐ)。
  const suppressClick = useRef(false);
  const [removing, setRemoving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  // 長押しメニューを開いている位置 (画面座標)。閉じているときは null。
  //
  // **開いているメニューを 1 つに保つのに、親へ持ち上げる必要はない。**
  // RowActionMenu は document の pointerdown を capture で拾って閉じるので、
  // 別の行を押した時点で先に閉じる (スワイプの開閉が openItemNo を親に
  // 置いているのは、あちらが「押されていない間も開いたまま」だから)
  const [menuAt, setMenuAt] = useState<MenuPoint | null>(null);

  const apply = (next: SwipeState) => {
    stateRef.current = next;
    setOffset(next.offset);
    setDragging(next.phase === "dragging");
  };

  // 親が別の行を開いた等でこの行の開閉指示が変わったら、指を離している間だけ
  // 追従する (ドラッグ中に横取りしない)。ref は effect の中で触る。
  useEffect(() => {
    if (stateRef.current.phase === "idle") {
      apply(settleSwipe(isOpen));
    }
  }, [isOpen]);

  const busy = removing || isPending;

  // 長押しでメニューを開く (docs/66 §5)。
  //
  // rightClick: "native" … PC の右クリックはブラウザ既定のメニューに渡す。
  // 行の当たり判定は本物のリンク (stretched link) で、「右クリックで URL を
  // コピー」は ItemRow が守ると明言している性質なので奪えない。PC には
  // ホバーのボタン列があり、長押しの代わりはそちらが務める
  const longPress = useLongPress(
    (point) => {
      if (busy) return;
      // 開きかけの引き出しは畳む。引き出しとメニューが同時に出ていると、
      // どちらの削除を押したのか判らなくなる
      onOpenChange(false);
      setMenuAt(point);
    },
    { rightClick: "native" },
  );

  // ボタン列の上で始まった押下は、スワイプにも長押しにも渡さない。
  // ボタンを押しただけで行が滑ったり、押しているうちにメニューが
  // ボタンを覆って出てくるのを防ぐ
  const isOnRowAction = (target: EventTarget | null) =>
    target instanceof Element && target.closest(ROW_ACTION_SELECTOR) !== null;

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (busy) return;
    // マウスは左ボタンのときだけ (右クリックのコンテキストメニューを邪魔しない)。
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (isOnRowAction(e.target)) return;
    // 新しいジェスチャの開始で、前のドラッグが残した抑止フラグを捨てる。
    // 大きく払って開くと click が飛んでこず、抑止フラグが消費されないまま
    // 残る。それを次のタップ (閉じる操作) の click が食ってしまうため、
    // ここで必ずリセットする。同じジェスチャ内の click だけを抑止できる。
    suppressClick.current = false;
    // **マウスでは長押しを仕掛けない。** PC の近道はホバーのボタン列 (§4) で、
    // こちらは指のための入口。仕掛けると、ゆっくりクリックした人 (0.5 秒は
    // 意外と短い) の click が握り潰され、ノートが開かない行になる。
    // ペンは指と同じ扱い — ホバーを持たない入力なので長押しが要る
    if (e.pointerType !== "mouse") {
      longPress.handlers.onPointerDown(e);
    }
    apply(beginSwipe(stateRef.current, e.clientX, e.clientY, e.timeStamp));
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    longPress.handlers.onPointerMove(e);
    const prev = stateRef.current;
    if (prev.phase === "idle") return;
    const next = moveSwipe(prev, e.clientX, e.clientY, e.timeStamp);
    // 横と確定した瞬間だけ pointer を捕まえ、枠の外へ出ても move を受け続ける。
    if (next.phase === "dragging" && prev.phase !== "dragging") {
      // **同時にここで長押しを捨てる。** 取り消しの閾値はスワイプが 8px
      // (SWIPE_SLOP)、長押しが 10px (LONG_PRESS_MOVE_TOLERANCE_PX) で 2px
      // 重なっており、その隙間まで払って指を止めると、引き出しが開いたまま
      // 0.5 秒後にメニューまで出る
      longPress.cancel();
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    apply(next);
  };

  const handlePointerUp = () => {
    longPress.handlers.onPointerUp();
    const prev = stateRef.current;
    if (prev.phase !== "dragging") {
      // ドラッグに至らなかった (=タップ)。開閉は動かさない。click 側で処理する。
      if (prev.phase === "tracking") {
        apply(settleSwipe(isOpen));
      }
      return;
    }
    if (prev.dragged) {
      suppressClick.current = true;
    }
    const open = resolveOpen(prev);
    apply(settleSwipe(open));
    onOpenChange(open);
  };

  const handlePointerCancel = () => {
    longPress.handlers.onPointerCancel();
    handlePointerUp();
  };

  const handleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    // **ボタン列への click は何があっても素通しする。** 下の 2 つはどちらも
    // 「行のどこかを押した」ことを前提にした握り潰しで、ボタンに掛けると
    // 押しても何も起きないボタンになる — 引き出しが開いている間や、
    // ドラッグで開いた直後 (suppressClick が残っている) に実際そうなる。
    // capture 段で stopPropagation するとボタン自身の onClick まで届かない
    if (isOnRowAction(e.target)) {
      return;
    }
    // 長押しを終えた指離しの click は、長押し側が握り潰す (メニューを出した
    // だけのつもりでノートが開くのを防ぐ)。**スワイプの判定より先に見る** —
    // 後にすると「開いていないタップ」として素通りする
    if (longPress.handlers.onClick(e)) {
      return;
    }
    // ドラッグ直後の click は 1 回だけ握りつぶす。
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // 開いている間の行タップは「閉じる」だけ。ノートへは飛ばさない
    // (iOS 標準の作法。誤操作でノートが開くのを防ぐ)。
    if (stateRef.current.offset !== 0) {
      e.preventDefault();
      e.stopPropagation();
      onOpenChange(false);
    }
  };

  const handleDelete = () => {
    if (busy) return;
    setFailed(false);
    setRemoving(true);
    const formData = new FormData();
    formData.append("itemNo", itemNo);
    startTransition(async () => {
      try {
        await trashAction(formData);
        // 成功時は revalidate で一覧からこの行ごと消えるので、畳んだまま待つ。
      } catch (error) {
        // **成功しても例外は飛んでくる。** trashItemsAction は最後に
        // redirect() を呼び、これは内部エラーを投げることで動く仕組みなので、
        // 素の catch は成功した削除まで「失敗」にしてしまう (実際、消えた行の
        // 上に一瞬エラーが出ていた)。フレームワークの例外はここで投げ直す
        unstable_rethrow(error);
        // 本物の失敗は畳みを戻してエラーを見せる (静かに握りつぶさない)。
        setRemoving(false);
        setFailed(true);
      }
    });
  };

  // 行アクションの一覧 (docs/66 §3)。ホバーのボタン列と長押しメニューは
  // どちらもこれを描くので、1 つ足せば両方に同時に現れる。
  // useMemo で包まない — 読む側 (ボタン列・メニュー) はどちらも毎描画で
  // 描き直す軽い部品で、同一性に依存する所が無い
  const actions: RowAction[] = [
    {
      key: "trash",
      label: "ゴミ箱へ移動",
      icon: <TrashIcon />,
      danger: true,
      onSelect: handleDelete,
    },
  ];

  const open = offset !== 0;
  const isCard = view === "card";

  // 削除実行後の消え方。小は高さ 0 へ潰し (一覧が詰まる)、大はフェードだけ
  // (高さ可変・グリッドで隣に揃うので潰しても空セルが残る。docs/43 §9-1)。
  const removingClass = isCard ? "opacity-0" : "max-h-0 opacity-0";
  // 潰さないときの高さ上限。小だけ max-h を効かせ、大はカードの高さに任せる。
  const restingClass = isCard ? "" : "max-h-24";

  return (
    <li
      // overflow-hidden … はみ出した削除ボタンと、畳むときの高さを切る。
      // liClassName … カードの枠 (h-full rounded border bg-white)。小では空。
      className={`relative overflow-hidden transition-all duration-200 ${liClassName} ${
        removing ? removingClass : restingClass
      }`}
    >
      {/* 背面: 右端に固定した削除ボタン。inset-y-0 で行 / カードの全高に伸びる */}
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy || !open}
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        aria-label={`#${itemNo} を削除`}
        style={{ width: SWIPE_BUTTON_WIDTH }}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-600 text-sm font-medium text-white disabled:opacity-60"
      >
        {isPending ? "…" : "削除"}
      </button>

      {/* 前面: 既存の行。指に追従してずらす。カードは h-full で枠の高さに追従 */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        // **onPointerLeave は繋がない。** タッチのポインタは pointerdown で
        // 押した要素に暗黙に捕まるので、指が行の外へ出ても leave は来ず、
        // 代わりに **pointerup の直後・互換 click の前**に後始末として飛んでくる。
        // 繋ぐと長押し成立の印がそこで倒れ、続く click が握り潰されずに
        // stretched link がノートを開く — 開いたばかりのメニューごと消える。
        // 指が行から離れた場合の取り消しは onPointerMove の 10px 判定が既に見ている
        onContextMenu={longPress.handlers.onContextMenu}
        onClickCapture={handleClickCapture}
        // pan-y … 縦スクロールはブラウザに任せ、横だけこちらが取る。
        // ドラッグ中だけ transition を外して指に張り付かせる。
        //
        // group … ホバーでアイコンボタン列を出すための的 (docs/66 §4)。
        // touch:select-none / -webkit-touch-callout:none … 長押しに反応させる
        // ための備え (§5-2)。iOS はリンクを長押しすると既定でプレビューの
        // 吹き出しを出し、こちらのメニューに重なる。**行の当たり判定は本物の
        // <a> なので、contextmenu を止めるだけでは防げない**。選択の禁止は
        // タッチだけに絞る — PC まで効かせると一覧の文字をマウスで選べなくなる
        className={`group relative bg-white touch-pan-y touch:select-none [-webkit-touch-callout:none] ${
          isCard ? "h-full" : ""
        } ${dragging ? "" : "transition-transform duration-200"}`}
        style={{ transform: `translateX(${offset}px)` }}
      >
        {children}
        {/* PC 用のボタン列。スマホでは hover が無いので出ない (§4) */}
        <RowActionButtons itemNo={itemNo} actions={actions} view={view} />
        {failed && (
          <p className="px-4 pb-1 text-sm text-red-600" role="alert">
            削除に失敗しました。通信を確認して再度お試しください。
          </p>
        )}
      </div>

      {/* 長押しメニュー (§5-3)。**前面 div の中に置いてはいけない** —
          あちらは translateX を持ち、transform のある要素は fixed の包含
          ブロックになるので、画面座標のつもりの位置が行の中を指す。
          ここに置けば body へ portal されるだけで、li の overflow-hidden にも
          切られない */}
      {menuAt && (
        <RowActionMenu
          label={`#${itemNo} の操作`}
          actions={actions}
          at={menuAt}
          onClose={() => setMenuAt(null)}
        />
      )}
    </li>
  );
}
