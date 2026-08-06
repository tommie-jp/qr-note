"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  BOX_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui";
import {
  type ImportProgressView,
  useImportProgress,
} from "@/components/useImportProgress";
import { enexTooLargeMessage, MAX_ENEX_BYTES } from "@/lib/enex/limits";
import type { BaseImportReport } from "@/lib/importReport";
import { MAX_ZIP_BYTES, zipTooLargeMessage } from "@/lib/zip/limits";

// /api/import が返すレポート。**format で見分ける判別可能ユニオン**にして、
// 「ZIP なのに duplicateSkipped がある」ような組み合わせを型で締め出す
// (共通部分は lib/importReport.ts が正本)
type ImportReport =
  | ({ format: "zip" } & BaseImportReport & {
        conflictSkipped: number;
        restoredAttachments: number;
      })
  | ({ format: "enex" } & BaseImportReport & { duplicateSkipped: number });

interface ImportResponse {
  success: boolean;
  data: ImportReport | null;
  error: string | null;
}

// 拡張子で「どちらの形式のつもりか」を見る。**実際の振り分けはサーバが中身の
// 先頭バイトで行う** (拡張子は付け替えられる) ので、ここで見るのは
// 上限の出し分けと、上書き選択を出すかどうかの案内のためだけ。
function looksLikeZip(file: File): boolean {
  return file.name.toLowerCase().endsWith(".zip");
}

// 上限を超えていれば理由、収まっていれば null。**呼ぶたびに同じ答えになる**
// ので状態には持たず、その場で求める
function tooLargeMessage(file: File | null): string | null {
  if (file === null) {
    return null;
  }
  if (looksLikeZip(file)) {
    return file.size > MAX_ZIP_BYTES ? zipTooLargeMessage(file.size) : null;
  }
  return file.size > MAX_ENEX_BYTES ? enexTooLargeMessage(file.size) : null;
}

// 端末のファイルを選んで送るだけ。展開も変換もすべてサーバ側で行う
// (docs/28-エクスポート計画.md §3 / §4)。
export function NotesImporter() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  // **送る前に**大きさを見る。上限超過はエッジ (nginx / Caddy) が 413 で
  // ボディを読み捨てるため、送ってしまうと "Load failed" としか判らない
  // (サーバの JSON エラーは届かない)。理由を言葉で出せるのはここだけ。
  // 選んだ瞬間に出せるよう、状態ではなく描画のたびに求める
  const sizeError = tooLargeMessage(file);
  const isZip = file !== null && looksLikeZip(file);
  // 取り込み中だけサーバの控えを覗く (docs/28 §9)
  const progress = useImportProgress(busy);

  async function handleImport() {
    if (file === null || sizeError !== null) {
      return;
    }
    setError(null);
    setReport(null);
    setBusy(true);
    try {
      // **ファイルをそのまま本文にする** (multipart で包まない)。ZIP は
      // 500MB まで受けるので、包むとサーバ側が本文全体をメモリに載せることに
      // なる (docs/28 §3)。ブラウザは File をディスクから流して送るため、
      // こちら側でも中身を抱えずに済む。同時に送りたい設定はクエリへ
      const response = await fetch(
        `/api/import${overwrite ? "?overwrite=1" : ""}`,
        {
          method: "POST",
          body: file,
          credentials: "same-origin",
        },
      );
      const result: ImportResponse = await response.json();
      if (!response.ok || !result.success || result.data === null) {
        throw new Error(result.error ?? `取り込めませんでした (${response.status})`);
      }
      setReport(result.data);
      // 同じファイルを二度押しで二重に取り込みやすいので、成功したら選択を外す
      setFile(null);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    } catch (cause) {
      console.error("取り込みに失敗しました", cause);
      // fetch 自体の失敗 (TypeError: "Load failed" / "Failed to fetch") は
      // 応答が届く前に接続が切れたということ。素の文言を出しても意味が
      // 取れないので、考えられる原因を言葉にする
      if (cause instanceof TypeError) {
        setError(
          "送信が途中で切れました。ファイルが大きすぎるか、通信が不安定な可能性があります",
        );
      } else {
        setError(cause instanceof Error ? cause.message : "取り込めませんでした");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className={`${BOX_CLASS} space-y-3 py-4`}>
        <h2 className="font-bold">ファイルを選ぶ</h2>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,.enex,application/zip,application/xml,text/xml"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
          className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded file:border file:border-gray-300 file:bg-white file:px-3 file:font-medium"
        />

        {/* 衝突ポリシー (docs/28 §5)。**既定は上書きしない** — 戻す操作で
            手元の編集を黙って潰すほうが取り返しがつかない。番号を振り直す
            ENEX には関係がないので、.zip を選んだときだけ出す */}
        {isZip && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(event) => setOverwrite(event.target.checked)}
              className="mt-1 size-4 shrink-0"
            />
            <span>
              同じ番号のノートがあれば上書きする
              <span className="block text-gray-600">
                外しておくと、既にある番号のノートはそのまま残します (取り込み結果に件数を出します)。
              </span>
            </span>
          </label>
        )}

        <button
          type="button"
          onClick={handleImport}
          disabled={file === null || busy}
          className={PRIMARY_BUTTON_CLASS}
        >
          {busy ? "取り込み中…" : "取り込む"}
        </button>
        {busy && <ImportProgressBar progress={progress} />}
        {(sizeError ?? error) && (
          <p role="alert" className="text-sm text-red-700">
            {sizeError ?? error}
          </p>
        )}
      </section>

      {report && <ImportResult report={report} />}
    </div>
  );
}

// 取り込み中の待ち時間の見せ方 (docs/28-エクスポート計画.md §9)。
//
// 500MB を受けられるようになって、取り込みは分単位で待つ操作になった。
// 「取り込み中…」の一言だけでは、進んでいるのか固まっているのか見分けが
// 付かない。
//
// **数字が出せないときは黙る**。総バイト数を名乗らない相手では % を、
// 始まったばかりのうちは残り時間を出さない — 初速で計算した「残り 4000 秒」が
// 一瞬見えるのは、数字が無いより悪い。
function ImportProgressBar({ progress }: { progress: ImportProgressView | null }) {
  const percent = progress?.percent ?? null;

  return (
    <div className="space-y-2">
      <div
        className="h-2 overflow-hidden rounded bg-gray-200"
        role="progressbar"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="取り込みの進み具合"
      >
        <div
          // % が判らない間は「動いてはいる」ことだけ伝える細い帯にする
          className={`h-full bg-blue-600 transition-[width] duration-300 ${
            percent === null ? "w-1/12 animate-pulse" : ""
          }`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <p className="text-sm text-gray-600">
        {percent === null ? "取り込み中…" : `取り込み中… ${percent}%`}
        {progress?.remainingText && ` ・ ${progress.remainingText}`}
      </p>
      {progress?.phase === "notes" && (
        <p className="text-sm text-gray-600">
          ノートを反映しています ({progress.notesDone}/{progress.notesTotal})
        </p>
      )}
      <p className="text-sm text-gray-600">
        画像の変換とサムネイル作成に時間がかかります。このページを閉じずにお待ちください。
      </p>
    </div>
  );
}

function ImportResult({ report }: { report: ImportReport }) {
  return (
    <section className="space-y-4">
      <h2 className="font-bold">
        取り込み結果 (成功 {report.imported.length} 件 / 見送り{" "}
        {report.skipped.length} 件)
      </h2>

      {report.imported.length === 0 ? (
        <p className="text-gray-600">取り込めたノートはありませんでした。</p>
      ) : (
        <ul className="space-y-2">
          {report.imported.map((note) => (
            <li key={note.itemNo} className={`${BOX_CLASS} py-3`}>
              <Link
                href={`/item/${note.itemNo}`}
                className="text-blue-600 underline"
              >
                {note.itemNo}
              </Link>
              <span className="ml-2 text-gray-700">
                {note.title === "" ? "(無題)" : note.title}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 「あえて入れなかった」ものは失敗と分けて出す。既定どおり動いた
          結果なので、赤い「取り込めなかったもの」に混ぜると誤解を招く */}
      {report.format === "zip" && report.conflictSkipped > 0 && (
        <p className={`${BOX_CLASS} py-3 text-sm text-gray-700`}>
          同じ番号のノートが既にあるため {report.conflictSkipped}{" "}
          件は入れていません。入れ替えたいときは「同じ番号のノートがあれば上書きする」を
          選んでもう一度取り込んで下さい。
        </p>
      )}

      {report.format === "enex" && report.duplicateSkipped > 0 && (
        <p className={`${BOX_CLASS} py-3 text-sm text-gray-700`}>
          既に取り込み済みのノート {report.duplicateSkipped} 件は入れていません。
        </p>
      )}

      {report.format === "zip" && report.restoredAttachments > 0 && (
        <p className="text-sm text-gray-600">
          添付 {report.restoredAttachments} 件を戻しました。
        </p>
      )}

      {/* 画像検索の索引は作っていない。黙っていると「取り込んだのに画像検索で
          出てこない」だけが見えて、不具合と区別が付かない */}
      {report.deferredImageIndex > 0 && (
        <p className={`${BOX_CLASS} py-3 text-sm text-gray-700`}>
          画像 {report.deferredImageIndex} 枚は、画像検索の索引をまだ作っていません
          (一括取り込みでは重いため後回しにしています)。ノートの表示・全文検索は
          今のまま使えます。索引を作るには
          <code className="mx-1">npm run backfill:embeddings</code>
          を実行して下さい。
        </p>
      )}

      {/* 見送ったものは必ず出す。黙って落とすと「全部入った」と読めてしまう */}
      {report.skipped.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-bold">取り込めなかったもの</h3>
          <ul className="space-y-2">
            {report.skipped.map((entry, index) => (
              <li
                key={`${entry.label}-${index}`}
                className={`${BOX_CLASS} py-3 text-sm`}
              >
                <p className="font-medium">{entry.label}</p>
                <p className="text-gray-600">{entry.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link href="/" className={SECONDARY_BUTTON_CLASS}>
        一覧へ戻る
      </Link>
    </section>
  );
}
