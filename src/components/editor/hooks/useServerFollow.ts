"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { MEMO_BASELINE_EVENT } from "@/lib/editor/editorEvents";
import { isOlderBase } from "@/lib/editor/saveBase";

// (本文, 基点) の対。最後にサーバと揃えた版を持つ
export interface SyncedPair {
  text: string;
  base: string;
}

type Marker = RefObject<HTMLSpanElement | null>;

// 目印 (hidden の span) から囲みの form を辿る (UnsavedGuard と同じやり方)
export function formOf(marker: Marker): HTMLFormElement | null {
  return marker.current?.closest("form") ?? null;
}

// 本文をサーバ値へ揃え直したことを、同じフォームの中へ知らせる
// (UnsavedGuard が比較の基準を取り直す)。描画に依らない (DOM を辿るだけ) ので
// 部品の外に置く — effect の依存に載せずに済む
function notifyBaseline(marker: Marker): void {
  formOf(marker)?.dispatchEvent(new CustomEvent(MEMO_BASELINE_EVENT));
}

export interface ServerFollow {
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  base: string;
  setBase: Dispatch<SetStateAction<string>>;
  // 本文を外から差し替えたら CodeMirror を作り直す番号
  editorKey: number;
  // CodeMirror を作り直す (undo 履歴を切る)
  renewEditor: () => void;
  serverMoved: boolean;
  setServerMoved: Dispatch<SetStateAction<boolean>>;
  syncedRef: RefObject<SyncedPair>;
  markerRef: RefObject<HTMLSpanElement | null>;
  requestBaseline: (next: SyncedPair) => void;
}

// MemoEditor の (本文, 基点) と、サーバ再描画への追随 (docs/87 §2-3)。
// effect の順 (追随 → 揃え直しの知らせ) は MemoEditor から分ける前と同じ
export function useServerFollow({
  initialValue,
  baseProp,
}: {
  initialValue: string;
  baseProp: string;
}): ServerFollow {
  const follow = useFollowServerProps({ initialValue, baseProp });
  useBaselineNotice(follow);
  return follow;
}

// 揃え直しの知らせを、新しい (本文, 基点) が hidden input に入った**後**に撃つ。
//
// effect の中で即座に撃つと、UnsavedGuard は古い本文の form を基準に取り、
// 黙って追随した直後や「別の版を読み込む」の直後に、何も打っていないのに
// 引き止めが出ていた (2026-09-17 に修正)。requestBaseline が立てた印を、
// state が揃え先と一致したコミットの後で撃って下ろす
function useBaselineNotice({
  value,
  base,
  syncedRef,
  markerRef,
  baselinePendingRef,
}: ServerFollow & { baselinePendingRef: RefObject<boolean> }): void {
  useEffect(() => {
    if (!baselinePendingRef.current) {
      return;
    }
    const synced = syncedRef.current;
    if (value !== synced.text || base !== synced.base) {
      return;
    }
    baselinePendingRef.current = false;
    notifyBaseline(markerRef);
  }, [value, base, baselinePendingRef, syncedRef, markerRef]);
}

// 本文を外から差し替えたら CodeMirror を作り直す番号。
// **undo 履歴を切るため**で、差し替えを 1 手として履歴に残すと
// 「元に戻す」で古い本文 + 新しい基点の対ができ、検査を素通りしてしまう
function useEditorKey() {
  const [editorKey, setEditorKey] = useState(0);
  const renewEditor = useCallback(() => setEditorKey((key) => key + 1), []);
  return { editorKey, renewEditor };
}

// 揃え直しの知らせの撃ち方 (effect は持たない。撃つのは useBaselineNotice)
function useRequestBaseline(value: string, base: string) {
  // フォームを辿るための目印 (UnsavedGuard と同じやり方)
  const markerRef = useRef<HTMLSpanElement>(null);
  // 揃え直しの知らせ (notifyBaseline) を、state の反映を待って撃つための印
  const baselinePendingRef = useRef(false);
  // (本文, 基点) を next に揃え直した後で UnsavedGuard の基準を取り直させる。
  // state が既に一致している (= hidden input がもう next) ならその場で撃ち、
  // これから変わるなら印を立てて、揃ったコミットの後の effect に任せる
  const requestBaseline = useCallback(
    (next: SyncedPair) => {
      if (value === next.text && base === next.base) {
        notifyBaseline(markerRef);
      } else {
        baselinePendingRef.current = true;
      }
    },
    [value, base],
  );
  return { markerRef, baselinePendingRef, requestBaseline };
}

// サーバ再描画で (本文, 基点) が動いたときの追随 (docs/87 §2-3)。
//
//   打っていない        → 本文・基点とも黙って追随 (失うものが無い)
//   もう同じ            → 基点だけ追随 (保存直後など)
//   打っている最中      → どちらも保持 → 保存で競合になり、選ばせる
//
// value を依存に入れているのは「動いた瞬間の本文」を見るため。打鍵のたびに
// 走るが、対が揃っていれば即 return する
//
// 描画中同期 (SearchForm の syncedQuery と同じ形) にはしていない。
// 揃え直しの知らせ (notifyBaseline) を撃つ時点が UnsavedGuard の基準を決める
// ため、撃ち方を requestBaseline に集めてある (docs/93 §5-2)。
//
// state はこの effect と同じ関数で持つ (set-state-in-effect の検査が、
// 渡された setter では state の書き換えと気づけないため)
function useFollowServerProps({
  initialValue,
  baseProp,
}: {
  initialValue: string;
  baseProp: string;
}): ServerFollow & { baselinePendingRef: RefObject<boolean> } {
  const [value, setValue] = useState(initialValue);
  const [base, setBase] = useState(baseProp);
  // 打っている最中にサーバ側の本文が動いた (保持したまま保存時に確かめる)
  const [serverMoved, setServerMoved] = useState(false);
  const { editorKey, renewEditor } = useEditorKey();
  // 最後にサーバと揃えた (本文, 基点) の対。追随の判断に使う
  const syncedRef = useRef<SyncedPair>({ text: initialValue, base: baseProp });
  const { markerRef, baselinePendingRef, requestBaseline } = useRequestBaseline(value, base);

  useEffect(() => {
    const synced = syncedRef.current;
    if (synced.text === initialValue && synced.base === baseProp) {
      return;
    }
    // 競合の応答 (SaveState) はページを再描画しないので、「別の版を読み込む」で
    // 揃えた直後の props は揃えた版より**古い**ままのことがある。それを
    // 「サーバが動いた」と取ると、読み込んだ本文を即座に元へ引き戻してしまう
    // (2026-09-17 に修正)。基点の新旧で見分け、古い props には追随しない
    if (isOlderBase(baseProp, synced.base)) {
      return;
    }
    const pristine = value === synced.text;
    const sameAsIncoming = value === initialValue;
    syncedRef.current = { text: initialValue, base: baseProp };

    // props → state の追随は effect で行う (docs/87 の芯。docs/128 §8-2 で残すと
    // 決めた)。上のとおり描画中同期にすると知らせの撃つ時点が決められない。
    // 追随は対が動いたときだけで、揃えた後は先頭の比較で即 return するので連鎖しない
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!pristine && !sameAsIncoming) {
      setServerMoved(true);
      return;
    }
    setBase(baseProp);
    if (!sameAsIncoming) {
      setValue(initialValue);
      renewEditor();
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    requestBaseline({ text: initialValue, base: baseProp });
    // renewEditor は参照が変わらない (useCallback([]))。足しても走る時点は変わらない
  }, [initialValue, baseProp, value, base, requestBaseline, renewEditor]);

  return {
    value,
    setValue,
    base,
    setBase,
    editorKey,
    renewEditor,
    serverMoved,
    setServerMoved,
    syncedRef,
    markerRef,
    requestBaseline,
    baselinePendingRef,
  };
}
