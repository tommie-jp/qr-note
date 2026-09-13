"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { isStandaloneDisplay, subscribeDisplayMode } from "@/lib/displayMode";
import { ModalOverlay } from "../modal/ModalOverlay";
import { useBodyScrollLock } from "../modal/useBodyScrollLock";
import { useEscapeKey } from "../modal/useEscapeKey";
import { BUSY_SPINNER_CLASS, SECONDARY_BUTTON_CLASS } from "../ui";

// 一度に描く文字数の上限。10MB の CSV をそのまま <pre> に流すと、テキスト
// ノード 1 つで数百万文字になりモバイルでは描画だけで固まる。頭を出せば
// 「何のファイルか」は判るので、超えた分は切って**切ったことを明示する**
// (黙って切ると、全部読めていると誤解したまま中身を見落とす)
const MAX_DISPLAY_CHARS = 200_000;

// 読み込みを諦めるまでの時間。10MB を細い回線で取ることも考えて長めに取る
const FETCH_TIMEOUT_MS = 30_000;

interface TextViewerModalProps {
  url: string;
  // 表示名 (挿入時のファイル名)。ヘッダに出す
  label: string;
  onClose: () => void;
}

// テキスト添付のビューア。ページ内のモーダルとして開くので**画面遷移が起きない**
// (PdfViewerModal と同じ作り。理由は TextLink.tsx の冒頭)。
//
// **中身は React が文字列として描く。** markdown や HTML として解釈しない —
// 添付は「預かったファイルの中身」であって本文ではないので、そのまま見せるのが
// 正しく、かつ解釈しないことがそのまま安全側に倒れる (.md も生のまま出す)。
export function TextViewerModal({ url, label, onClose }: TextViewerModalProps) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 「新しいタブ」を出してよいか。**ブラウザだと判るまで出さない**。
  // standalone では target="_blank" が効かず、同じ webview がテキストの生表示へ
  // 遷移して戻れなくなる (displayMode.ts と 41-QR-search/docs/12 に経緯)
  const canOpenNewTab = useSyncExternalStore(
    subscribeDisplayMode,
    () => !isStandaloneDisplay(),
    () => false,
  );

  useEscapeKey(onClose);

  // 開いている間は後ろのページをスクロールさせない (iOS のスクロール伝播よけ)
  useBodyScrollLock();

  useEffect(() => {
    let cancelled = false;
    // 文字コードは考えなくてよい。保存時に UTF-8 へ正規化し、配信も
    // charset=utf-8 で返している (normalizeText.ts / uploads.ts textSaveInfo)。
    //
    // **時間を切る**。切らないと、通信が固まったときスピナーが回り続けるだけで
    // 成功にもエラーにもならず、待てば直るのか壊れているのかが判らなくなる
    fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      .then(async (res) => {
        if (!res.ok) {
          // 配信 API は理由を JSON で返す (「ログインが必要です」/「画像が
          // 見つかりません」)。それを捨てて HTTP 番号だけ出すと、ログインし直せば
          // 直るのか添付そのものが消えたのかを見分けられない
          const reason = await res
            .json()
            .then((body: { error?: string }) => body.error)
            .catch(() => null);
          throw new Error(reason || `HTTP ${res.status}`);
        }
        return res.text();
      })
      .then((loaded) => {
        if (!cancelled) {
          setText(loaded);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) {
          return;
        }
        setError(
          e instanceof Error && e.name === "TimeoutError"
            ? "時間内に読み込めませんでした。通信状況を確かめて開き直して下さい。"
            : e instanceof Error
              ? e.message
              : String(e),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const truncated = text !== null && text.length > MAX_DISPLAY_CHARS;

  return (
    <ModalOverlay variant="viewer">
      <div className="flex items-center gap-3 bg-white px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-bold">{label}</span>
        {/* 逃げ道: ブラウザ起動なら別タブで開いて保存もできる。
            standalone では戻れなくなるので**出さない** (canOpenNewTab) */}
        {canOpenNewTab && (
          <a
            href={url}
            rel="noreferrer"
            target="_blank"
            className="shrink-0 text-blue-700 underline"
          >
            新しいタブ
          </a>
        )}
        <button
          type="button"
          onClick={onClose}
          className={`shrink-0 ${SECONDARY_BUTTON_CLASS}`}
        >
          閉じる
        </button>
      </div>

      <div className="flex-1 overflow-auto px-2 py-3">
        {error && (
          <p className="mx-auto max-w-md rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            テキストを表示できませんでした: {error}
          </p>
        )}
        {text === null && !error && (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-white">
            <span aria-hidden className={BUSY_SPINNER_CLASS} />
            テキストを読み込んでいます…
          </p>
        )}
        {text !== null && (
          <div className="mx-auto max-w-3xl rounded bg-white p-3">
            {/* 折り返しつきの等幅。CSV の長い行を横スクロールに追いやらない */}
            <pre className="whitespace-pre-wrap break-words font-mono text-sm">
              {truncated ? text.slice(0, MAX_DISPLAY_CHARS) : text}
            </pre>
            {truncated && (
              <p className="mt-2 border-t border-gray-200 pt-2 text-sm text-gray-500">
                長いので先頭 {MAX_DISPLAY_CHARS.toLocaleString()} 文字だけ
                表示しています。
                {/* 「新しいタブ」を出していない standalone では案内しない
                    (存在しない導線を指してしまう) */}
                {canOpenNewTab && "全体は「新しいタブ」から開けます。"}
              </p>
            )}
          </div>
        )}
      </div>
    </ModalOverlay>
  );
}
