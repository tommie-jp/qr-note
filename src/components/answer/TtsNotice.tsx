"use client";

import { dismissTtsHint } from "@/lib/ttsSilence";

interface TtsNoticeProps {
  // 出す文。null なら何も描かない
  message: string | null;
  // 案内 (消せる) か、失敗の警告 (消せない) か
  dismissible: boolean;
  onDismiss: () => void;
}

// 発音ボタンの下に出す知らせ (docs/81-単語TTS発音計画.md §6-3)。
//
// **行に 1 つだけ、答えの後ろに出す。** ボタンの隣に置くと、答えの途中に
// 長い文が割り込んで単語も訳も読めなくなる (実際に一度そうなった)。
//
// 2 種類ある:
//   案内 … 鳴らした回に添える「聞こえないときは〜」。消音かどうかは
//          判定できないので、聞こえている人にも出る → **消せる**
//   警告 … 本当に音が出なかったとき。消す口は付けない (次に押せば消える)
export function TtsNotice({
  message,
  dismissible,
  onDismiss,
}: TtsNoticeProps) {
  if (message === null) {
    return null;
  }
  return (
    // block … 答えの行を割らずに下へ落とす
    <span className="mt-0.5 block text-xs" role="status">
      <span className={dismissible ? "text-gray-600" : "font-medium text-red-700"}>
        {dismissible ? "🔇" : "⚠"} {message}
      </span>
      {dismissible && (
        <button
          type="button"
          // 案内を出し続けるかは端末の設定次第なので、消す判断も端末に覚える
          className="ml-2 whitespace-nowrap px-1 text-sky-700 underline"
          onClick={() => {
            dismissTtsHint(window.localStorage);
            onDismiss();
          }}
        >
          表示しない
        </button>
      )}
    </span>
  );
}
