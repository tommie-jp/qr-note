"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BOX_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/ui";
import { countRenumbered, type ImportReport } from "@/lib/importReportView";

// 一覧に出す「取り込めなかったもの」の上限。
//
// 関係のない ZIP は取り込み口が 1 行で断る (importZip の assertOurZip) ので
// ここまで来ないが、**ノートに紛れたゴミ**は現実に何百件も出る (vault に
// 置いた .DS_Store や __MACOSX/ など)。全部並べると本当に見たい 1 行が
// 埋もれるので、頭だけ出して残りは件数で伝える
const SKIPPED_SHOWN = 20;

// 件数の知らせを囲む枠。注意 (warning) は QR シールとの対応が崩れたときだけ
const NOTICE_TONE_CLASS = {
  info: "text-gray-700",
  warning: "text-amber-700",
} as const;

function ReportNotice({
  tone = "info",
  children,
}: {
  tone?: keyof typeof NOTICE_TONE_CLASS;
  children: ReactNode;
}) {
  return (
    <p className={`${BOX_CLASS} py-3 text-sm ${NOTICE_TONE_CLASS[tone]}`}>
      {children}
    </p>
  );
}

// /api/import が返したレポートを描く (docs/28-エクスポート計画.md §3 / §4)
export function ImportResult({ report }: { report: ImportReport }) {
  const renumbered = countRenumbered(report);

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
        <ReportNotice tone="warning">
          {renumbered}{" "}
          件は番号が空いていなかったため、新しい番号で取り込みました
          (上の一覧の「旧 → 新」)。これらのノートは、印刷済みの QR
          シールとは対応しません。
        </ReportNotice>
      )}

      {/* 「あえて入れなかった」ものは失敗と分けて出す。既定どおり動いた
          結果なので、赤い「取り込めなかったもの」に混ぜると誤解を招く */}
      {report.format === "zip" && report.conflictSkipped > 0 && (
        <ReportNotice>
          同じ番号のノートが既にあるため {report.conflictSkipped}{" "}
          件は入れていません。入れ替えたいときは「上書きする」を、
          両方残したいときは「新しい番号で取り込む」を選んでもう一度取り込んで下さい。
        </ReportNotice>
      )}

      {/* ZIP の duplicateSkipped は「番号は衝突したが、同じ内容のノートが
          既にいた」= 再実行で増えなかったということ (docs/28 §5) */}
      {report.format === "zip" && report.duplicateSkipped > 0 && (
        <ReportNotice>
          同じ内容のノートが既にあるため {report.duplicateSkipped}{" "}
          件は新しい番号を振らずに入れていません (同じ ZIP
          を取り込み直しても増えません)。
        </ReportNotice>
      )}

      {report.format === "enex" && report.duplicateSkipped > 0 && (
        <ReportNotice>
          既に取り込み済みのノート {report.duplicateSkipped} 件は入れていません。
        </ReportNotice>
      )}

      {report.format === "zip" && report.restoredAttachments > 0 && (
        <p className="text-sm text-gray-600">
          添付 {report.restoredAttachments} 件を戻しました。
        </p>
      )}

      {/* 画像検索の索引は作っていない。黙っていると「取り込んだのに画像検索で
          出てこない」だけが見えて、不具合と区別が付かない */}
      {report.deferredImageIndex > 0 && (
        <ReportNotice>
          画像 {report.deferredImageIndex} 枚は、画像検索の索引をまだ作っていません
          (一括取り込みでは重いため後回しにしています)。ノートの表示・全文検索は
          今のまま使えます。索引を作るには
          <code className="mx-1">npm run backfill:embeddings</code>
          を実行して下さい。
        </ReportNotice>
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
