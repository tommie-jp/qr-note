"use client";

import { ServerClipboardView } from "./ServerClipboardView";
import { useServerClipboard } from "./useServerClipboard";

// ハンバーガーメニューの「サーバへコピー」「サーバからペースト」
// (docs/114-サーバクリップボード計画.md)。
//
// Windows と iPhone の間で OS のクリップボードの中身 (文字・画像) と、選んだファイル
// (写真・動画・音声・PDF・テキスト) を、サーバの
// 1 枠 (10 分で消える) を介して運ぶ。ノートを介さないので、受け渡しのたびに
// ノートを開いて更新する手数も、ノートの履歴が汚れることも無い。
//
// **ログイン中の非デモだけ出す** (AppHeaderMenu)。デモは共有アカウントなので
// 1 枠が全員に見える。API も同じ理由でデモを断る。
export function ServerClipboardMenuItems() {
  const state = useServerClipboard();
  return (
    <ServerClipboardView
      slot={state.slot}
      loadFailed={state.loadFailed}
      busy={state.busy}
      notice={state.notice}
      now={state.now}
      onSend={state.send}
      onSendFile={state.sendFile}
      onDropFiles={state.dropFiles}
      onReceive={state.receive}
      onClear={state.clear}
    />
  );
}
