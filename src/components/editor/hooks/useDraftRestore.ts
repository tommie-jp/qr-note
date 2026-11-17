"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { draftStorageKey, loadDraft } from "@/lib/prefs/memoDraft";
import { useDraftAutosave } from "./useDraftAutosave";
import type { SyncedPair } from "./useServerFollow";

export interface DraftRestore {
  // 未保存の下書きを復元したことの知らせ (黙って差し替えない)
  restoredDraft: boolean;
  // 復元の判定が済んだか。済むまで保存側 (useDraftAutosave) を止める
  draftReady: RefObject<boolean>;
  // 復元した下書きを捨てて、保存済みの本文に戻す
  discardDraft: () => void;
}

// マウント時に一度だけ、未保存の下書きがあれば復元する (MemoEditor から分けた)。
// localStorage が使えない環境 (プライベートモード等) では下書き保護なしで
// 通常動作に落ちる (下書きは保険であって本筋ではない)
export function useDraftRestore({
  draftKey,
  initialValue,
  setValue,
  setBase,
  renewEditor,
}: {
  draftKey: string | undefined;
  initialValue: string;
  setValue: Dispatch<SetStateAction<string>>;
  setBase: Dispatch<SetStateAction<string>>;
  renewEditor: () => void;
}): DraftRestore {
  const [restoredDraft, setRestoredDraft] = useState(false);
  // 復元の判定が済むまで保存側を止める (先に保存が走ると、これから読む
  // 下書きを「初期値と同じ」として消しかねない)
  const draftReady = useRef(false);

  // 本体は effect event に置き、effect は初回だけ呼ぶ。draftKey / initialValue は
  // ページ遷移で作り直されるので、途中で変わっても読み直さない。マウント時の
  // effect の中から同期に呼ぶので、読むのは初回の描画の値で前の閉包と同じ
  const restoreDraft = useEffectEvent(() => {
    if (draftKey) {
      try {
        const restored = loadDraft(window.localStorage, draftKey, initialValue);
        if (restored !== null) {
          setValue(restored.value);
          // **本文と対で基点も戻す** (docs/87 §2-6)。いまの版を当てると、
          // タブが落ちている間に別の端末が保存した分を黙って潰せてしまう。
          // 基点を持たない古い下書きは stale = 必ず競合になる
          setBase(restored.base);
          setRestoredDraft(true);
        }
      } catch {
        // 読めない環境では何もしない
      }
    }
    draftReady.current = true;
  });
  useEffect(() => {
    // useState の初期化で読むと SSR の出力とずれて hydration が壊れる。
    // 「hydration 後に localStorage と一度だけ同期する」ためのマウント時
    // effect であり、連鎖レンダリングは起きない (依存なしで再実行されない)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    restoreDraft();
  }, []);

  const discardDraft = () => {
    setValue(initialValue);
    renewEditor();
    setRestoredDraft(false);
    if (draftKey) {
      try {
        window.localStorage.removeItem(draftStorageKey(draftKey));
      } catch {
        // 消せなくても実害はない (次の編集で上書きされる)
      }
    }
  };

  return { restoredDraft, draftReady, discardDraft };
}

// 下書きの復元 → 保存の順で繋ぐ (MemoEditor から分ける前と同じ順)。
// 保存は復元の判定が済むまで止まる (draftReady)
export function useMemoDraft({
  draftKey,
  initialValue,
  value,
  base,
  setValue,
  setBase,
  renewEditor,
  syncedRef,
}: {
  draftKey: string | undefined;
  initialValue: string;
  value: string;
  base: string;
  setValue: Dispatch<SetStateAction<string>>;
  setBase: Dispatch<SetStateAction<string>>;
  renewEditor: () => void;
  syncedRef: RefObject<SyncedPair>;
}): Omit<DraftRestore, "draftReady"> {
  const { restoredDraft, draftReady, discardDraft } = useDraftRestore({
    draftKey,
    initialValue,
    setValue,
    setBase,
    renewEditor,
  });
  useDraftAutosave({ draftKey, value, base, initialValue, readyRef: draftReady, syncedRef });
  return { restoredDraft, discardDraft };
}
