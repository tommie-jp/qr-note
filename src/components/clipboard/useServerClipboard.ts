"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearServerSlot,
  fetchServerSlot,
  receiveFromServer,
  sendClipboardToServer,
  serverClipboardErrorMessage,
} from "@/lib/clipboard/serverClipboard";
import { type ClipboardSlotMeta, slotLabel } from "@/lib/clipboard/slot";
import type { ServerClipboardBusy, ServerClipboardNotice } from "./ServerClipboardView";

// 成功の知らせを出しておく時間。失敗は次の操作まで残す (読み終える前に消えない)
const OK_NOTICE_MS = 3000;

export interface ServerClipboardState {
  slot: ClipboardSlotMeta | null | undefined;
  loadFailed: boolean;
  busy: ServerClipboardBusy;
  notice: ServerClipboardNotice | null;
  // 枠を読んだ(置いた)時刻。「3 分前」の基準
  now: Date;
  send: () => void;
  receive: () => void;
  clear: () => void;
}

// サーバ経由のクリップボードの状態と操作 (docs/114-サーバクリップボード計画.md §3)。
//
// **メニューは開いている間だけ中身を描く** (HeaderMenu) ので、マウント = メニューを
// 開いた瞬間。そこで枠を読み直す — layout に何も足さず、古い値も掴まない。
//
// **send / receive は押した同期部から lib の関数を呼ぶ。** read() / writeText() を
// await の後に回すと iOS が弾く (lib/clipboard/serverClipboard.ts の頭)。ここでの
// setBusy は状態更新で、待たないので同期部を壊さない。
export function useServerClipboard(): ServerClipboardState {
  const [slot, setSlot] = useState<ClipboardSlotMeta | null | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<ServerClipboardBusy>(null);
  const [notice, setNotice] = useState<ServerClipboardNotice | null>(null);
  const [now, setNow] = useState(() => new Date());
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopNoticeTimer = useCallback(() => {
    if (noticeTimer.current !== null) {
      clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    }
  }, []);

  const showOk = useCallback(
    (text: string) => {
      stopNoticeTimer();
      setNotice({ tone: "ok", text });
      noticeTimer.current = setTimeout(() => setNotice(null), OK_NOTICE_MS);
    },
    [stopNoticeTimer],
  );

  const showError = useCallback(
    (text: string) => {
      stopNoticeTimer();
      setNotice({ tone: "error", text });
    },
    [stopNoticeTimer],
  );

  const applySlot = useCallback((next: ClipboardSlotMeta | null) => {
    setSlot(next);
    setNow(new Date());
  }, []);

  // 開いたときに 1 回読む
  useEffect(() => {
    let alive = true;
    fetchServerSlot()
      .then((meta) => {
        if (alive) {
          applySlot(meta);
        }
      })
      .catch((cause: unknown) => {
        console.error("サーバのクリップボードを読めませんでした:", cause);
        if (alive) {
          setLoadFailed(true);
        }
      });
    return () => {
      alive = false;
      stopNoticeTimer();
    };
  }, [applySlot, stopNoticeTimer]);

  const send = () => {
    if (busy !== null) {
      return;
    }
    setBusy("send");
    setNotice(null);
    // 同期部で呼ぶ (read() を await の後に回さない)
    sendClipboardToServer()
      .then((meta) => {
        setLoadFailed(false);
        applySlot(meta);
        showOk(`サーバへ送りました (${slotLabel(meta)})`);
      })
      .catch((cause: unknown) => {
        console.error("サーバのクリップボードへ送れませんでした:", cause);
        showError(serverClipboardErrorMessage(cause, "send"));
      })
      .finally(() => setBusy(null));
  };

  const receive = () => {
    if (busy !== null || !slot) {
      return;
    }
    setBusy("receive");
    setNotice(null);
    receiveFromServer(slot)
      .then(() => showOk("クリップボードにコピーしました"))
      .catch((cause: unknown) => {
        console.error("サーバのクリップボードを受け取れませんでした:", cause);
        showError(serverClipboardErrorMessage(cause, "receive"));
        // 期限切れや他の端末の「消す」で、押した時点で枠が無いことがある。
        // 表示を実際に合わせる (失敗の知らせは残す)
        fetchServerSlot()
          .then(applySlot)
          .catch(() => {});
      })
      .finally(() => setBusy(null));
  };

  const clear = () => {
    if (busy !== null) {
      return;
    }
    setBusy("clear");
    setNotice(null);
    clearServerSlot()
      .then(() => {
        applySlot(null);
        showOk("サーバのクリップボードを消しました");
      })
      .catch((cause: unknown) => {
        console.error("サーバのクリップボードを消せませんでした:", cause);
        showError(serverClipboardErrorMessage(cause, "receive"));
      })
      .finally(() => setBusy(null));
  };

  return { slot, loadFailed, busy, notice, now, send, receive, clear };
}
