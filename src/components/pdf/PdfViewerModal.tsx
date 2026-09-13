"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  isRenderCancelled,
  loadPdfDocument,
  type PdfDocumentHandle,
} from "./pdfService";
import { isStandaloneDisplay, subscribeDisplayMode } from "@/lib/displayMode";
import { errorText } from "@/lib/errorMessage";
import { isShareAborted, shareFile, shouldOfferShare } from "@/lib/shareFile";
import { ModalOverlay } from "../modal/ModalOverlay";
import { useBodyScrollLock } from "../modal/useBodyScrollLock";
import { useEscapeKey } from "../modal/useEscapeKey";
import { BUSY_SPINNER_CLASS, SECONDARY_BUTTON_CLASS } from "../ui";

// ページを先読みする距離。スクロールで現れる直前に描き始めることで、
// 白いページが見えている時間を減らす
const PRELOAD_MARGIN_PX = 300;

// ページ寸法が判るまでの見込み比率 (A4 縦)。実測が入れば置き換わる
const FALLBACK_ASPECT = 842 / 595;

interface PdfViewerModalProps {
  url: string;
  // 表示名 (挿入時のファイル名)。ヘッダに出す
  label: string;
  onClose: () => void;
}

// PDF の 1 ページ。画面に入ったら描き、出たら canvas を解放する。
//
// **解放が要る理由**: canvas は 幅 x 高さ x 4 バイトを実メモリで持つ。
// 描いたまま残すと、長い PDF を最後までスクロールしただけで数百 MB になり、
// iOS WebKit のメモリ上限に当たってタブごと落ちる。
function PdfPage({
  doc,
  pageNumber,
  cssWidth,
  aspect,
}: {
  doc: PdfDocumentHandle;
  pageNumber: number;
  cssWidth: number;
  aspect: number;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { rootMargin: `${PRELOAD_MARGIN_PX}px` },
    );
    observer.observe(holder);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible || cssWidth <= 0) {
      return;
    }
    let alive = true;
    setFailed(false);
    doc.renderPage(pageNumber, canvas, cssWidth).catch((error: unknown) => {
      // 中断は正常系 (閉じた・画面外に出た・幅が変わった)
      if (!alive || isRenderCancelled(error)) {
        return;
      }
      console.error(`PDF ${pageNumber} ページ目の描画に失敗しました:`, error);
      setFailed(true);
    });

    // テキストレイヤは絵とは独立に載せる。失敗しても選択できなくなるだけで
    // 絵は出ているので、ページ全体をエラーにはしない
    const textLayer = textLayerRef.current;
    if (textLayer) {
      doc
        .renderTextLayer(pageNumber, textLayer, cssWidth)
        .catch((error: unknown) => {
          if (!alive || isRenderCancelled(error)) {
            return;
          }
          console.error(
            `PDF ${pageNumber} ページ目のテキストレイヤに失敗しました:`,
            error,
          );
        });
    }

    return () => {
      alive = false;
      // 描き込み中の canvas を 0 幅にしないよう、先に中断する
      doc.cancelPage(pageNumber);
      canvas.width = 0;
      canvas.height = 0;
      // テキストの span も破棄する (ページあたり数百ノードになるため)
      textLayer?.replaceChildren();
    };
  }, [doc, pageNumber, cssWidth, visible]);

  return (
    <div
      ref={holderRef}
      // relative … テキストレイヤ (absolute inset-0) を絵にぴったり重ねるため
      className="relative mx-auto bg-white shadow"
      // 描く前・解放後も高さを保ち、スクロール位置が飛ばないようにする
      style={{ width: cssWidth, minHeight: cssWidth * aspect }}
    >
      {failed ? (
        <p className="p-4 text-sm text-red-700">
          {pageNumber} ページ目を表示できませんでした。
        </p>
      ) : (
        <>
          <canvas ref={canvasRef} aria-label={`${pageNumber} ページ目`} />
          {/* 透明な文字を絵の上に重ねる (選択・コピー・検索・読み上げ用)。
              スタイルは globals.css の .textLayer */}
          <div ref={textLayerRef} className="textLayer" />
        </>
      )}
    </div>
  );
}

// PDF ビューア本体。ページ内のモーダルとして開くので**画面遷移が起きない**。
// ホーム画面から起動した iOS PWA (standalone) には戻るボタンが無く、別タブで
// PDF を開くとアプリを強制終了するまで戻れなくなるため (pdfService.ts の冒頭)。
export function PdfViewerModal({ url, label, onClose }: PdfViewerModalProps) {
  const [doc, setDoc] = useState<PdfDocumentHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aspect, setAspect] = useState(FALLBACK_ASPECT);
  const [pageWidth, setPageWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 「新しいタブ」を出してよいか。**ブラウザだと判るまで出さない**。
  // ホーム画面起動 (standalone) では target="_blank" が効かず、同じ webview が
  // PDF へ遷移して戻れなくなる — このビューアで直したはずの不具合に、
  // ヘッダの導線から逆戻りしてしまう (displayMode.ts に経緯)。
  // サーバ側スナップショットは false (= 出さない) にして、判るまで導線を作らない
  const canOpenNewTab = useSyncExternalStore(
    subscribeDisplayMode,
    () => !isStandaloneDisplay(),
    () => false,
  );

  // 共有シートへの導線。共有が「唯一の出口」でありかつ実際に動く iOS でだけ
  // 出す (shouldOfferShare)。PC は「新しいタブ」からネイティブビューアで保存でき、
  // Chromium (Win/Android) は files 付き share を恒久拒否する (shareFile.ts)
  const canShare = useSyncExternalStore(
    // 対応可否は実行中に変わらないので購読しない
    () => () => {},
    () => shouldOfferShare(),
    () => false,
  );

  useEscapeKey(onClose);

  // 開いている間は後ろのページをスクロールさせない (iOS のスクロール伝播よけ)
  useBodyScrollLock();

  // 読み込みと後始末。閉じたら worker ごと破棄する — 抱えたままだと
  // wasm ヒープが残り、後から開く OCR や画像検索がモデルを積めずに落ちる
  useEffect(() => {
    let handle: PdfDocumentHandle | null = null;
    let cancelled = false;

    loadPdfDocument(url)
      .then(async (loaded) => {
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        handle = loaded;
        // 1 ページ目の比率を全ページの見込みに使う (ほとんどの PDF は同じ大きさ)。
        // 取れなくても既定の A4 比で表示できるので、失敗しても止めない
        try {
          const { width, height } = await loaded.pageSize(1);
          if (!cancelled && width > 0) {
            setAspect(height / width);
          }
        } catch {
          // 見込み比率のままにする
        }
        if (!cancelled) {
          setDoc(loaded);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(errorText(e));
        }
      });

    return () => {
      cancelled = true;
      void handle?.destroy();
    };
  }, [url]);

  // 共有シートを開く。バイト列は表示のために読み込み済みのものを使うので、
  // ここで通信は起きない (通信を挟むと iOS が transient activation 切れで弾く)
  const handleShare = async () => {
    if (!doc) {
      return;
    }
    try {
      await shareFile(await doc.getData(), label, "application/pdf");
    } catch (e) {
      // 共有シートを閉じただけならエラーではない
      if (isShareAborted(e)) {
        return;
      }
      setError(errorText(e));
    }
  };

  // ページの表示幅を器から測る。回転・リサイズにも追従させる
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      // 左右の余白ぶんを引く (px-2 = 8px x 2)
      setPageWidth(Math.max(0, el.clientWidth - 16));
    }
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [measure]);

  return (
    <ModalOverlay variant="viewer">
      <div className="flex items-center gap-3 bg-white px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-bold">{label}</span>
        {/* 逃げ道: ブラウザ起動なら内蔵ビューアの方が快適なこともある。
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
        {/* 印刷・保存・他アプリ送りは OS の共有シートに委ねる。standalone には
            他に PDF を外へ出す手段が無いので、ここが唯一の出口になる */}
        {canShare && doc && (
          <button
            type="button"
            onClick={() => void handleShare()}
            className={`shrink-0 ${SECONDARY_BUTTON_CLASS}`}
          >
            共有
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className={`shrink-0 ${SECONDARY_BUTTON_CLASS}`}
        >
          閉じる
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto px-2 py-3">
        {error && (
          <p className="mx-auto max-w-md rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            PDF を表示できませんでした: {error}
          </p>
        )}
        {!doc && !error && (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-white">
            <span aria-hidden className={BUSY_SPINNER_CLASS} />
            PDF を読み込んでいます…
          </p>
        )}
        {doc && pageWidth > 0 && (
          <div className="flex flex-col items-center gap-3">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage
                key={i + 1}
                doc={doc}
                pageNumber={i + 1}
                cssWidth={pageWidth}
                aspect={aspect}
              />
            ))}
          </div>
        )}
      </div>
    </ModalOverlay>
  );
}
