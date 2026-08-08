"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

// 画面下部の帯 (PageBottomBar) と、その中に編集ボタンを差し込む側
// (MemoEditorInner) をつなぐ context。
//
// 編集ボタンの状態・ハンドラは MemoEditorInner に残したまま、DOM の置き場所だけ
// 帯へ移したい (createPortal)。そのために「差し込み口の DOM」をこの context
// 経由で受け渡す。
//
// hostEl … 帯の中の差し込み口 (PageBottomBar が callback ref で登録する)。
// 差し込む側はここへ portal する。null の間は portal しない。
//
// hasSlot … 差し込みたい側が今いるか。false なら帯そのものを描かない。
// ← → をヘッダーへ戻した (docs/11 §5-2) 結果この帯から常設の中身が無くなり、
// 編集していないページでは空の帯だけが画面下端に居座るようになったため。
// 「中身が入っているか」を hostEl の子から数える手もあるが、portal 先の DOM を
// React の外から覗くことになるので、差し込む側に申告してもらう。
//
// 申告が先、口が後。帯が無ければ hostEl も無く、hostEl が無ければ portal も
// 起きない — 「中身が入ったら帯を出す」順では永久に出ない。
interface BottomBarContextValue {
  hostEl: HTMLElement | null;
  // PageBottomBar が差し込み口の DOM を登録する callback ref。
  // state セッターなので、口が出来た瞬間に購読側が再描画される
  setHostEl: (el: HTMLElement | null) => void;
  // 差し込みたい側が 1 つ以上いるか
  hasSlot: boolean;
  // 差し込みたいと申告する。戻り値は取り下げる関数 (useEffect の後片付け用)。
  // 直接は呼ばず useBottomBarSlot 経由で使う
  requestSlot: () => () => void;
}

const BottomBarContext = createContext<BottomBarContextValue | null>(null);

export function BottomBarProvider({ children }: { children: ReactNode }) {
  const [hostEl, setHostEl] = useState<HTMLElement | null>(null);
  // 数で持つ。真偽値だと、差し込む側が 2 つ居るときに片方の取り下げで
  // 帯ごと消える (今は 1 つだけだが、数え方を間違えると原因を追いにくい)
  const [slotCount, setSlotCount] = useState(0);

  // 参照を安定させる — 購読側の useEffect が毎描画で回り直さないように。
  // 取り下げは 1 回だけ効かせる (StrictMode の二重呼び出しで負にしない)
  const requestSlot = useCallback(() => {
    setSlotCount((n) => n + 1);
    let isReleased = false;
    return () => {
      if (isReleased) return;
      isReleased = true;
      setSlotCount((n) => n - 1);
    };
  }, []);

  const value = useMemo(
    () => ({ hostEl, setHostEl, hasSlot: slotCount > 0, requestSlot }),
    [hostEl, slotCount, requestSlot],
  );

  return (
    <BottomBarContext.Provider value={value}>
      {children}
    </BottomBarContext.Provider>
  );
}

// Provider の外で使われたら握りつぶさず気付けるようにする。
// 下部バーは layout で全ページを包むので、通常は必ず内側にいる
export function useBottomBar(): BottomBarContextValue {
  const ctx = useContext(BottomBarContext);
  if (!ctx) {
    throw new Error("useBottomBar は BottomBarProvider の内側で使って下さい");
  }
  return ctx;
}

// 帯へ差し込みたい側が使う。active の間だけ帯を出させ、差し込み口を返す。
// 口が返るのは帯が描かれた後 (= 申告の次の描画) なので、使う側は null が
// 返る期間がある前提で書く (null の間は portal しない)
export function useBottomBarSlot(active: boolean): HTMLElement | null {
  const { hostEl, requestSlot } = useBottomBar();

  useEffect(() => {
    if (!active) return;
    return requestSlot();
  }, [active, requestSlot]);

  return active ? hostEl : null;
}
