"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useRouter } from "next/navigation";
import { errorText } from "@/lib/errorMessage";
import { pendingRotation } from "@/lib/images/rotationState";
import { parseUploadResponse } from "@/lib/uploads/uploadResponse";
import { CopyImageButton } from "./CopyImageButton";
import { useAsyncAction } from "./hooks/useAsyncAction";
import { ModalOverlay } from "./modal/ModalOverlay";
import { useEscapeKey } from "./modal/useEscapeKey";
import { IMAGE_OVERLAY_BUTTON_CLASS } from "./ui";

type ZoomableImageProps = ComponentProps<"img"> & {
  // 拡大表示に 90° 回転ボタンを出すか (docs/49-画像回転計画.md §2)。
  // ノート閲覧 (ItemView) からだけ true。公開ビュー・docs では出さない
  allowRotate?: boolean;
};

// 連打を 1 リクエストにまとめる待ち時間 (ms)。押すたびに CSS で即回し、
// 手が止まってからまとめて 1 回だけ保存する (docs/49 §2)。
const ROTATE_DEBOUNCE_MS = 800;

// クエリ/ハッシュを落とした配信パス。回転 API は `<path>/rotate` に生える
function imagePath(src: string): string {
  return src.split(/[?#]/)[0];
}

// 新 URL の画像を先に読み込んでから差し替える (差し替えた瞬間に割れて見えない)。
// 読み込みに失敗しても差し替えは進める — 保存済み画像は正しく、表示の一時的な
// 失敗で回転を無かったことにする方が困る
function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

// メモ内の画像。クリックで画面内に収まる最大サイズの拡大表示を開き、
// もう一度のクリックか Esc で閉じる。allowRotate なら拡大表示に 90° 回転ボタンを
// 出す (docs/49-画像回転計画.md)。
// react-markdown は画像を <p> 内に置くため、オーバーレイは
// <p> に入れられない <div> を body へポータルで逃がす
export function ZoomableImage({
  alt,
  allowRotate = false,
  ...props
}: ZoomableImageProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  // 実際に表示している src。回転が確定すると新 URL へ差し替わる
  const [currentSrc, setCurrentSrc] = useState(
    typeof props.src === "string" ? props.src : "",
  );
  // CSS で即時に見せる累計回転角 (deg)。保存確定 or 失敗で 0 に戻す
  const [displayAngle, setDisplayAngle] = useState(0);
  const { run, busy: isSaving, error } = useAsyncAction();
  // タイマー確定時に読む累計角。state は描画用、確定判定はこの ref を正とする
  // (連打で state 更新が溜まっても取りこぼさない)
  const angleRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => setIsOpen(false), []);
  useEscapeKey(close, isOpen);

  // アンマウント時に確定待ちのタイマーを止める
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  // CSS 回転の累計を 0 に戻す (ref と描画用 state は常に一緒に動かす)
  function resetAngle() {
    angleRef.current = 0;
    setDisplayAngle(0);
  }

  async function commitRotation() {
    const angle = pendingRotation(angleRef.current);
    // 一周して戻った (0°) なら送らず、表示だけ戻す
    if (angle === null) {
      resetAngle();
      return;
    }
    await run(
      async () => {
        const res = await fetch(`${imagePath(currentSrc)}/rotate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ angle }),
        });
        // アップロードと同じ共通エンベロープ。失敗は例外で返る (uploads/uploadResponse.ts)
        const newUrl = parseUploadResponse(res.status, await res.text());
        await preloadImage(newUrl);
        // 差し替えと CSS 回転リセットは同時に (別々だとチラつく)
        resetAngle();
        setCurrentSrc(newUrl);
        // 回転はノート本文の書き換え (URL 置換) なので、サーバ描画を取り直して
        // ページ全体を新 URL へ追随させる。とくに**まだ開いていない編集タブ**は
        // これで新しい本文を初期値にマウントできる (MemoPanel は開くまで遅延)。
        // クライアント状態 (このコンポーネントの currentSrc、開いた overlay、
        // 編集中の CodeMirror) は refresh でも保持される
        router.refresh();
      },
      (e) => {
        // 失敗は握り潰さず表示に出し、CSS 回転を元へ戻す
        resetAngle();
        return errorText(e, "回転に失敗しました");
      },
    );
  }

  function onRotateClick(e: React.MouseEvent) {
    // オーバーレイの閉じ (onClick) と分離する
    e.stopPropagation();
    if (isSaving) {
      return;
    }
    // 押すたびに +90 を積む。確定 (commitRotation) はこの ref を正とする
    angleRef.current += 90;
    setDisplayAngle(angleRef.current);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      void commitRotation();
    }, ROTATE_DEBOUNCE_MS);
  }

  // 押した回転だけアニメーションし、0° へのリセットは瞬時に行う。
  // 確定時は既に**回転済みの新画像**へ差し替わっているので、そこからさらに
  // 90°→0° をアニメーションすると「もう一回回った」ように見えてしまう
  // (transition を残したままにしていた初版の不具合)。リセット (= displayAngle 0)
  // では transition を切って、差し替えと同時に一瞬で 0° に戻す
  const rotateStyle = {
    transform: `rotate(${displayAngle}deg)`,
    transition: displayAngle === 0 ? "none" : "transform 150ms ease",
  };

  return (
    <>
      <button
        type="button"
        className="cursor-zoom-in"
        onClick={() => setIsOpen(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          {...props}
          src={currentSrc}
          alt={alt}
          style={{ ...props.style, ...rotateStyle }}
        />
      </button>
      {isOpen && (
        <ModalOverlay variant="zoom" onClose={close}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentSrc}
            alt={alt}
            className="max-h-full max-w-full"
            style={rotateStyle}
          />
          {/* 覆いの上の操作。**コピーは allowRotate に関わらず出す** —
              回転は自分のノートでだけ許す書き換えだが、コピーは読むだけで、
              公開ビューでも同じように要る (docs/92 §3)。
              閉じ (覆いの onClick) と分けるため、まとめて伝播を止める */}
          <div
            className="absolute bottom-4 right-4 flex flex-col items-end gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {error && (
              <p className="rounded bg-black/70 px-2 py-1 text-sm text-red-300">
                {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              <CopyImageButton src={currentSrc} />
              {allowRotate && (
                <button
                  type="button"
                  aria-label="90度回転"
                  disabled={isSaving}
                  onClick={onRotateClick}
                  className={`${IMAGE_OVERLAY_BUTTON_CLASS} px-4 py-3 text-lg`}
                >
                  {isSaving ? "…" : "↻"}
                </button>
              )}
            </div>
          </div>
        </ModalOverlay>
      )}
    </>
  );
}
