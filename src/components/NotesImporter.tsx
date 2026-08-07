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
import type { ConflictPolicy } from "@/lib/zip/conflictPolicy";
import { MAX_ZIP_BYTES, zipTooLargeMessage } from "@/lib/zip/limits";

// /api/import が返すレポート。**format で見分ける判別可能ユニオン**にして、
// 「ZIP なのに restoredAttachments が無い」ような組み合わせを型で締め出す
// (共通部分は lib/importReport.ts が正本)。duplicateSkipped は両方が持つが、
// 意味は違う — ENEX は「既に取り込み済み」、ZIP は「衝突したが同内容だった」
type ImportReport =
  | ({ format: "zip" } & BaseImportReport & {
        conflictSkipped: number;
        duplicateSkipped: number;
        restoredAttachments: number;
      })
  | ({ format: "enex" } & BaseImportReport & { duplicateSkipped: number });

// 衝突したときの 3 択 (docs/28-エクスポート計画.md §5)。
//
// **既定は「そのまま残す」** — 戻す操作で手元の編集を黙って潰すほうが
// 取り返しがつかない。3 つ目の注意書きは選ぶ人にだけ見えればよいが、
// **選ぶ前に見えていなければ意味がない**ので選択肢に添えて常に出す
const CONFLICT_CHOICES: {
  value: ConflictPolicy;
  label: string;
  description: string;
  caution?: string;
}[] = [
  {
    value: "skip",
    label: "そのまま残す",
    description:
      "ZIP 側を入れず、既にある番号のノートをそのまま残します (取り込み結果に件数を出します)。",
  },
  {
    value: "overwrite",
    label: "上書きする",
    description:
      "既にある番号のノートを ZIP の内容で置き換えます。手元の編集は消えます。",
  },
  {
    value: "renumber",
    label: "新しい番号で取り込む",
    description:
      "既にあるノートはそのまま残し、ZIP 側のノートには空き番号を振って両方入れます (別のインスタンスのノートを取り込むとき)。",
    caution:
      "新しい番号を振ったノートは、印刷済みの QR シールとは対応しなくなります。",
  },
];

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
  const [conflict, setConflict] = useState<ConflictPolicy>("skip");
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
      const response = await fetch(`/api/import?conflict=${conflict}`, {
        method: "POST",
        body: file,
        credentials: "same-origin",
      });
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

        {/* 衝突ポリシー (docs/28 §5)。**既定はそのまま残す** — 戻す操作で
            手元の編集を黙って潰すほうが取り返しがつかない。番号を振り直す
            ENEX には関係がないので、.zip を選んだときだけ出す */}
        {isZip && (
          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium">
              同じ番号のノートが既にあるとき
            </legend>
            {CONFLICT_CHOICES.map((choice) => (
              <label key={choice.value} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="conflict"
                  value={choice.value}
                  checked={conflict === choice.value}
                  onChange={() => setConflict(choice.value)}
                  className="mt-1 size-4 shrink-0"
                />
                <span>
                  {choice.label}
                  <span className="block text-gray-600">
                    {choice.description}
                  </span>
                  {choice.caution && (
                    <span className="block text-amber-700">
                      {choice.caution}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
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

// 一覧に出す「取り込めなかったもの」の上限。
//
// 関係のない ZIP は取り込み口が 1 行で断る (importZip の assertOurZip) ので
// ここまで来ないが、**ノートに紛れたゴミ**は現実に何百件も出る (vault に
// 置いた .DS_Store や __MACOSX/ など)。全部並べると本当に見たい 1 行が
// 埋もれるので、頭だけ出して残りは件数で伝える
const SKIPPED_SHOWN = 20

function ImportResult({ report }: { report: ImportReport }) {
  const renumbered = report.imported.filter(
    (note) => note.renumberedFrom !== undefined,
  ).length;

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
              {/* 振り直したものは「旧 → 新」で出す。どれが振り直されたか
                  判らないと、手元の QR シールとの対応を確かめられない */}
              {note.renumberedFrom !== undefined && (
                <span className="text-gray-500">
                  {note.renumberedFrom}
                  {" → "}
                </span>
              )}
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

      {/* 番号が変わったことは QR シールの貼り替えに直結する。一覧の
          「旧 → 新」だけでは見落とすので、件数も別に出す */}
      {renumbered > 0 && (
        <p className={`${BOX_CLASS} py-3 text-sm text-amber-700`}>
          {renumbered}{" "}
          件は番号が空いていなかったため、新しい番号で取り込みました
          (上の一覧の「旧 → 新」)。これらのノートは、印刷済みの QR
          シールとは対応しません。
        </p>
      )}

      {/* 「あえて入れなかった」ものは失敗と分けて出す。既定どおり動いた
          結果なので、赤い「取り込めなかったもの」に混ぜると誤解を招く */}
      {report.format === "zip" && report.conflictSkipped > 0 && (
        <p className={`${BOX_CLASS} py-3 text-sm text-gray-700`}>
          同じ番号のノートが既にあるため {report.conflictSkipped}{" "}
          件は入れていません。入れ替えたいときは「上書きする」を、
          両方残したいときは「新しい番号で取り込む」を選んでもう一度取り込んで下さい。
        </p>
      )}

      {/* ZIP の duplicateSkipped は「番号は衝突したが、同じ内容のノートが
          既にいた」= 再実行で増えなかったということ (docs/28 §5) */}
      {report.format === "zip" && report.duplicateSkipped > 0 && (
        <p className={`${BOX_CLASS} py-3 text-sm text-gray-700`}>
          同じ内容のノートが既にあるため {report.duplicateSkipped}{" "}
          件は新しい番号を振らずに入れていません (同じ ZIP
          を取り込み直しても増えません)。
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
          <h3 className="font-bold">
            取り込めなかったもの ({report.skipped.length} 件)
          </h3>
          <ul className="space-y-2">
            {report.skipped.slice(0, SKIPPED_SHOWN).map((entry, index) => (
              <li
                key={`${entry.label}-${index}`}
                className={`${BOX_CLASS} py-3 text-sm`}
              >
                <p className="font-medium">{entry.label}</p>
                <p className="text-gray-600">{entry.reason}</p>
              </li>
            ))}
          </ul>
          {report.skipped.length > SKIPPED_SHOWN && (
            <p className="text-sm text-gray-600">
              ほか {report.skipped.length - SKIPPED_SHOWN} 件は省略しました。
            </p>
          )}
        </div>
      )}

      <Link href="/" className={SECONDARY_BUTTON_CLASS}>
        一覧へ戻る
      </Link>
    </section>
  );
}
