"use client";

import {
  createContext,
  use,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { buildItemFormData } from "@/lib/items/itemSelection";
import type { MenuOrigin } from "@/lib/gesture/rowActionMenu";
import { RestoreIcon, TrashIcon } from "../../icons";
import { purgeConfirmMessage } from "../../trash/purgeConfirm";
import { RowActionMenu } from "./RowActionMenu";
import { RowMenuTrigger, anchorOriginOf, type RowAction } from "./RowActions";
import { tileTrashConfirmMessage } from "./tileTrash";
import { sendNoteAction, type NoteAction } from "./noteAction";
import { sendTrash, type RowSearchState } from "./useRowTrash";

// 画像モードのタイルの ⋮ (docs/107-行メニュー計画.md §7・§9)。
//
// タイルは画像 1 枚ごとで、同じノートのタイルが何枚も並ぶ。そこで送信の
// 状態とメニューの中身は**一覧に 1 つの包み (Provider)** が持ち、各タイルの
// TileActions は context で引くだけにする。部品ごとに持つと、同じノートの
// 他のタイルの ⋮ が押せるままで二重に送れ、覆いも失敗の文も押した 1 枚に
// しか出ない。
//
// 包みは 2 種類。中身 (メニューの項目) だけが違い、状態の持ち方は共通:
//   SearchTileMenuProvider … 検索一覧。ゴミ箱へ移動 (確認付き)
//   TrashTileMenuProvider  … ゴミ箱の一覧。復元 / 永久削除 (確認付き)
//
// タイルの li を持つ ImageMasonry はサーバでも描ける部品なので、状態は
// この client の包みに置く。

// ノート 1 件ぶんの送信の状態。
//   busy    … 押した瞬間から覆いを掛ける (サーバ反映まで「押したのに残って
//             いる」ように見せない)。成功時は revalidate でタイルごと消える
//   failure … 本物の失敗の文。覆いを外して同じノートのタイル全部に出す
interface NoteState {
  busy: boolean;
  failure: string | null;
}

const IDLE: NoteState = { busy: false, failure: null };

interface TileMenu {
  stateOf: (itemId: string) => NoteState;
  actionsFor: (itemId: string, name: string, tileCount: number) => RowAction[];
}

const TileMenuContext = createContext<TileMenu | null>(null);

// ノート単位の送信の状態。run は同じノートの送信が済むまで次を受けない
function useNoteSubmissions() {
  const [states, setStates] = useState<ReadonlyMap<string, NoteState>>(
    () => new Map(),
  );
  // 送信中の番号。**二重送信の見張りは state ではなく ref で持つ** — state は
  // 次の描画まで古い値のままなので、描画の前に 2 回選ばれる (2 枚のタイルから・
  // キーの連打) と両方が通る。永久削除だと、再利用されたかもしれない番号へ
  // 2 度目が飛ぶ
  const inFlight = useRef<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const setStateOf = (itemId: string, next: NoteState | null) =>
    setStates((prev) => {
      const map = new Map(prev);
      if (next) {
        map.set(itemId, next);
      } else {
        map.delete(itemId);
      }
      return map;
    });

  const stateOf = (itemId: string) => states.get(itemId) ?? IDLE;

  const run = (itemId: string, send: () => Promise<boolean>, failure: string) => {
    if (inFlight.current.has(itemId)) return;
    inFlight.current.add(itemId);
    setStateOf(itemId, { busy: true, failure: null });
    startTransition(async () => {
      const ok = await send();
      inFlight.current.delete(itemId);
      // **成功したら状態を消す。** 送った後の revalidate でタイルは消えるが、
      // 包みは残る (3 ペインでは一覧がそのまま居る)。詳細ペインのバナーなどで
      // 同じノートが戻ってきたとき、busy が残っていると覆いが掛かったまま
      // 開けなくなる
      setStateOf(itemId, ok ? null : { busy: false, failure });
    });
  };

  return { stateOf, run };
}

interface SearchTileMenuProviderProps {
  trashAction: NoteAction;
  searchState: RowSearchState;
  children: ReactNode;
}

// 検索一覧の画像モード。ゴミ箱へ入れる前に確認する (tileTrash.ts) —
// 行では確認しない (66 §3) が、タイルは「この画像だけ消す」と読まれやすく、
// 同じノートの他のタイルもまとめて消えるので、ユーザーの指定で聞く
export function SearchTileMenuProvider({
  trashAction,
  searchState,
  children,
}: SearchTileMenuProviderProps) {
  const { stateOf, run } = useNoteSubmissions();
  const actionsFor = (itemId: string, name: string, tileCount: number): RowAction[] => [
    {
      key: "trash",
      label: "ゴミ箱へ移動",
      icon: <TrashIcon />,
      danger: true,
      onSelect: () => {
        if (!window.confirm(tileTrashConfirmMessage(name, tileCount))) {
          return;
        }
        run(
          itemId,
          () => sendTrash(itemId, trashAction, searchState),
          "削除に失敗しました。通信を確認して再度お試しください。",
        );
      },
    },
  ];
  return <TileMenuContext value={{ stateOf, actionsFor }}>{children}</TileMenuContext>;
}

interface TrashTileMenuProviderProps {
  restoreAction: NoteAction;
  purgeAction: NoteAction;
  children: ReactNode;
}

// ゴミ箱の一覧の画像表示 (docs/107 §9)。行の「復元」「永久削除」と同じ
// サーバーアクションを、フォームではなく FormData を組んで呼ぶ。
// どちらもリダイレクトせず、revalidate で一覧が描き直されてタイルが消える。
//
// 復元は確認しない (行の「復元」ボタンと同じ。戻すだけで失う物が無い)。
// 永久削除は行と同じ文で確認する (purgeConfirm.ts)
export function TrashTileMenuProvider({
  restoreAction,
  purgeAction,
  children,
}: TrashTileMenuProviderProps) {
  const { stateOf, run } = useNoteSubmissions();
  const send = (action: NoteAction, itemId: string) =>
    sendNoteAction(action, buildItemFormData(itemId));
  const actionsFor = (itemId: string, name: string, tileCount: number): RowAction[] => [
    {
      key: "restore",
      label: "復元",
      icon: <RestoreIcon />,
      onSelect: () =>
        run(
          itemId,
          () => send(restoreAction, itemId),
          "復元に失敗しました。通信を確認して再度お試しください。",
        ),
    },
    {
      key: "purge",
      label: "永久削除",
      icon: <TrashIcon />,
      danger: true,
      onSelect: () => {
        if (!window.confirm(purgeConfirmMessage(name, tileCount))) {
          return;
        }
        run(
          itemId,
          () => send(purgeAction, itemId),
          "永久削除に失敗しました。通信を確認して再度お試しください。",
        );
      },
    },
  ];
  return <TileMenuContext value={{ stateOf, actionsFor }}>{children}</TileMenuContext>;
}

interface TileActionsProps {
  itemId: string;
  // 読み上げ・確認文で名乗るノートの呼び名 (lib/items/noteName.ts)
  name: string;
  // このページに並ぶ、同じノートのタイルの数 (確認文で言う)
  tileCount: number;
}

// タイルの ⋮ と、そのメニュー・送信中の覆い・失敗の文。
//
// 行 (SwipeToTrashRow) と違い、スワイプ・長押し・ホバーの近道は付けない。
// タイルは画像 1 枚ごとの見た目で、画像を長押ししたらノートが消えた、を
// 起こさないため。入口は「#番号 タイトル」の隣の ⋮ だけにする。
//
// **li は持たない。** タイルの li は ImageMasonry が持ち、ここは中に足す
// 部品だけを返す。⋮ の位置はタイルの @container を基準にする
export function TileActions({ itemId, name, tileCount }: TileActionsProps) {
  const tileMenu = use(TileMenuContext);
  if (!tileMenu) {
    throw new Error(
      "TileActions は SearchTileMenuProvider か TrashTileMenuProvider の中に置く",
    );
  }
  const { busy, failure } = tileMenu.stateOf(itemId);
  const [menuOrigin, setMenuOrigin] = useState<MenuOrigin | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <RowMenuTrigger
        ref={triggerRef}
        name={name}
        view="tile"
        isOpen={menuOrigin !== null}
        disabled={busy}
        onClick={(event) => {
          // 押すたびに開閉する (行の ⋮ と同じ)
          setMenuOrigin(menuOrigin ? null : anchorOriginOf(event.currentTarget));
        }}
      />
      {busy && (
        // 送信中の覆い。同じノートのタイル全部に掛かる (状態はノート単位)。
        // z-20 … stretched link の膜と ⋮ (z-10) より前に出し、送信中に
        // ノートを開いたり ⋮ を押したりさせない
        <div
          aria-hidden
          className="absolute inset-0 z-20 bg-white/70 motion-safe:animate-pulse"
        />
      )}
      {failure && (
        // relative z-10 … stretched link の膜より前に出す (読めても押すと
        // ノートが開くのでは困る)。同じノートのタイル全部に出る
        <p
          className="relative z-10 px-1.5 pb-1 text-xs text-red-600"
          role="alert"
        >
          {failure}
        </p>
      )}
      {menuOrigin && (
        <RowActionMenu
          label={`${name}の操作`}
          actions={tileMenu.actionsFor(itemId, name, tileCount)}
          origin={menuOrigin}
          anchorRef={triggerRef}
          onClose={() => setMenuOrigin(null)}
        />
      )}
    </>
  );
}
