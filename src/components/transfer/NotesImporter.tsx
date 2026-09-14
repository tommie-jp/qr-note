"use client";

import { useRef, useState } from "react";
import { useAsyncAction } from "@/components/hooks/useAsyncAction";
import {
  BOX_CLASS,
  PRIMARY_BUTTON_CLASS,
} from "@/components/ui";
import { ImportProgressBar } from "@/components/transfer/ImportProgressBar";
import { ImportResult } from "@/components/transfer/ImportResult";
import { useImportProgress } from "@/components/transfer/useImportProgress";
import { errorText } from "@/lib/errorMessage";
import {
  type ImportReport,
  looksLikeZip,
  tooLargeMessage,
} from "@/lib/import/importReportView";
import type { ConflictPolicy } from "@/lib/zip/conflictPolicy";

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

// 端末のファイルを選んで送るだけ。展開も変換もすべてサーバ側で行う
// (docs/28-エクスポート計画.md §3 / §4)。
export function NotesImporter() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [conflict, setConflict] = useState<ConflictPolicy>("skip");
  const { run, busy, error, setError } = useAsyncAction();
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
    await run(
      async () => {
        setReport(null);
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
      },
      (cause) => {
        console.error("取り込みに失敗しました", cause);
        // fetch 自体の失敗 (TypeError: "Load failed" / "Failed to fetch") は
        // 応答が届く前に接続が切れたということ。素の文言を出しても意味が
        // 取れないので、考えられる原因を言葉にする
        if (cause instanceof TypeError) {
          return "送信が途中で切れました。ファイルが大きすぎるか、通信が不安定な可能性があります";
        }
        return errorText(cause, "取り込めませんでした");
      },
    );
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
