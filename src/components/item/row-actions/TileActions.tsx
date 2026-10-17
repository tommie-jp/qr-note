"use client";

import {
  createContext,
  use,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import type { MenuOrigin } from "@/lib/gesture/rowActionMenu";
import { TrashIcon } from "../../icons";
import { RowActionMenu } from "./RowActionMenu";
import { RowMenuTrigger, anchorOriginOf, type RowAction } from "./RowActions";
import { tileTrashConfirmMessage } from "./tileTrash";
import {
  sendTrash,
  type RowSearchState,
  type RowTrashAction,
} from "./useRowTrash";

// 画像モードのタイルの ⋮ (docs/107-行メニュー計画.md §7)。

// ノート 1 件ぶんの送信の状態。
//   removing … 押した瞬間から覆いを掛ける (サーバ反映まで「押したのに残って
//              いる」ように見せない)。成功時は revalidate でタイルごと消える
//   failed   … 本物の失敗。覆いを外してエラーを出す
interface NoteTrashState {
  removing: boolean;
  failed: boolean;
}

const IDLE: NoteTrashState = { removing: false, failed: false };

interface TileTrash {
  stateOf: (itemNo: string) => NoteTrashState;
  trash: (itemNo: string) => void;
}

const TileTrashContext = createContext<TileTrash | null>(null);

interface TileTrashProviderProps {
  trashAction: RowTrashAction;
  searchState: RowSearchState;
  children: ReactNode;
}

// 送信の状態を**ノート単位**で一覧に 1 つ持つ。
//
// 行 (useRowTrash) のように部品ごとに持つと、同じノートのタイルが 3 枚
// あっても、送信中・失敗を知るのは押した 1 枚だけになる。他のタイルの ⋮ は
// 押せるままで二重に送れてしまい、覆いも失敗の文も押した 1 枚にしか出ない。
//
// タイルの li を持つ ImageMasonry はサーバでも描ける部品 (ゴミ箱の一覧からも
// 使う) なので、状態はこの client の包みに置き、TileActions が context で引く
export function TileTrashProvider({
  trashAction,
  searchState,
  children,
}: TileTrashProviderProps) {
  const [states, setStates] = useState<ReadonlyMap<string, NoteTrashState>>(
    () => new Map(),
  );
  const [, startTransition] = useTransition();

  const setStateOf = (itemNo: string, next: NoteTrashState) =>
    setStates((prev) => new Map(prev).set(itemNo, next));

  const value: TileTrash = {
    stateOf: (itemNo) => states.get(itemNo) ?? IDLE,
    trash: (itemNo) => {
      if (states.get(itemNo)?.removing) return;
      setStateOf(itemNo, { removing: true, failed: false });
      startTransition(async () => {
        if (await sendTrash(itemNo, trashAction, searchState)) {
          return;
        }
        setStateOf(itemNo, { removing: false, failed: true });
      });
    },
  };

  return <TileTrashContext value={value}>{children}</TileTrashContext>;
}

interface TileActionsProps {
  itemNo: string;
  // このページに並ぶ、同じノートのタイルの数 (確認文で言う)
  tileCount: number;
}

// タイルの ⋮ と、そのメニュー・送信中の覆い・失敗の文。
//
// 行 (SwipeToTrashRow) と違い、スワイプ・長押し・ホバーの近道は付けない。
// タイルは画像 1 枚ごとの見た目で、画像を長押ししたらノートが消えた、を
// 起こさないため。入口は「#番号 タイトル」の隣の ⋮ だけにする。
//
// ゴミ箱へ入れる前に確認する (tileTrash.ts)。行では確認しない (66 §3) が、
// ここでは同じノートの他のタイルもまとめて消えるので、ユーザーの指定で聞く。
//
// **li は持たない。** タイルの li は ImageMasonry が持ち、ここは中に足す
// 部品だけを返す。⋮ の位置はタイルの @container を基準にする
export function TileActions({ itemNo, tileCount }: TileActionsProps) {
  const tileTrash = use(TileTrashContext);
  if (!tileTrash) {
    throw new Error("TileActions は TileTrashProvider の中に置く");
  }
  const { removing, failed } = tileTrash.stateOf(itemNo);
  const [menuOrigin, setMenuOrigin] = useState<MenuOrigin | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const actions: RowAction[] = [
    {
      key: "trash",
      label: "ゴミ箱へ移動",
      icon: <TrashIcon />,
      danger: true,
      onSelect: () => {
        if (window.confirm(tileTrashConfirmMessage(itemNo, tileCount))) {
          tileTrash.trash(itemNo);
        }
      },
    },
  ];

  return (
    <>
      <RowMenuTrigger
        ref={triggerRef}
        itemNo={itemNo}
        view="tile"
        isOpen={menuOrigin !== null}
        disabled={removing}
        onClick={(event) => {
          // 押すたびに開閉する (行の ⋮ と同じ)
          setMenuOrigin(menuOrigin ? null : anchorOriginOf(event.currentTarget));
        }}
      />
      {removing && (
        // 送信中の覆い。同じノートのタイル全部に掛かる (状態はノート単位)。
        // z-20 … stretched link の膜と ⋮ (z-10) より前に出し、送信中に
        // ノートを開いたり ⋮ を押したりさせない
        <div
          aria-hidden
          className="absolute inset-0 z-20 bg-white/70 motion-safe:animate-pulse"
        />
      )}
      {failed && (
        // relative z-10 … stretched link の膜より前に出す (読めても押すと
        // ノートが開くのでは困る)。同じノートのタイル全部に出る
        <p
          className="relative z-10 px-1.5 pb-1 text-xs text-red-600"
          role="alert"
        >
          削除に失敗しました。通信を確認して再度お試しください。
        </p>
      )}
      {menuOrigin && (
        <RowActionMenu
          label={`#${itemNo} の操作`}
          actions={actions}
          origin={menuOrigin}
          anchorRef={triggerRef}
          onClose={() => setMenuOrigin(null)}
        />
      )}
    </>
  );
}
