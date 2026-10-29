import type { Metadata } from "next";
import Link from "next/link";
import { PageTransition } from "@/components/chrome/PageTransition";
import { CopyTextButton } from "@/components/CopyTextButton";
import { ACTION_LINK_CLASS } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth/pageGuard";
import { formatJstDateTime } from "@/lib/datetime";
import {
  formatServerInfo,
  LEVEL_LABEL,
  SECTION_FAILED_PREFIX,
} from "@/lib/diag/formatServerInfo";
import { collectServerInfo } from "@/lib/diag/serverInfo";
import type { HealthLevel, InfoSection } from "@/lib/diag/types";

// 毎回集める。キャッシュすると「いまの」空きメモリが古い値になる
export const dynamic = "force-dynamic";

// サイト名は付けない。root layout の title.template が付ける
export const metadata: Metadata = {
  title: "サーバー情報",
};

// 判定の色。warn / error は /logs の LEVEL_BADGE と同じ (琥珀・赤)。ok は緑 —
// /logs の info (灰) は「失敗ではない」だが、ここの ok は「確かめて問題なし」なので
// 灰に埋めずに合格と分かる色にする
const LEVEL_BADGE: Readonly<Record<HealthLevel, string>> = {
  ok: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-800",
};

const BADGE_CLASS =
  "inline-block shrink-0 rounded px-1.5 py-0.5 text-xs font-medium";

function SectionBlock({ section }: { section: InfoSection }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold">{section.title}</h2>
      {section.result.kind === "failed" ? (
        // 空欄にしない (docs/109 §2)。理由まで出して次に何を見るか分かるようにする
        <p className="text-sm text-red-700">
          {SECTION_FAILED_PREFIX}: {section.result.message}
        </p>
      ) : (
        <dl className="divide-y divide-gray-200 rounded border border-gray-200 bg-white text-sm">
          {section.result.rows.map((row) => (
            // ラベルは固定幅で揃え、値は折り返す (PostgreSQL の版は 1 行に収まらない)
            <div key={row.label} className="flex gap-3 px-3 py-1.5">
              <dt className="w-36 shrink-0 text-gray-500">{row.label}</dt>
              <dd className="min-w-0 break-words text-gray-800">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

// サーバー情報 (docs/109-サーバー情報計画.md)。管理者だけ。
//
// ログインは二重に見る: proxy が楽観的な門番 (publicPaths に無いパスは既定で
// 閉じる) で、ページでも requireAdminPage() を重ねる。導線 (メニュー) も同じ
// 判定で隠すが、URL 直打ちに備えてここでも倒す。
//
// 読み直しはブラウザの再読み込みで足りる (ポーリングはしない。/logs と同じ)
export default async function ServerInfoPage() {
  await requireAdminPage();
  const info = await collectServerInfo();

  return (
    <PageTransition>
      <div className="space-y-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold">サーバー情報</h1>
          <Link
            href="/"
            transitionTypes={["nav-back"]}
            className={ACTION_LINK_CLASS}
          >
            検索へ
          </Link>
        </div>
        <div className="flex items-start justify-between gap-3">
          <p className="text-gray-500">
            {formatJstDateTime(info.collectedAt)} 時点。再読み込みで更新します。
          </p>
          <CopyTextButton
            text={formatServerInfo(info)}
            subject="サーバー情報"
          />
        </div>

        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            ヘルスチェック
            <span className={`${BADGE_CLASS} ${LEVEL_BADGE[info.overall]}`}>
              {LEVEL_LABEL[info.overall]}
            </span>
          </h2>
          <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white text-sm">
            {info.checks.map((check) => (
              <li
                key={check.name}
                className="flex items-start gap-3 px-3 py-1.5"
              >
                <span className={`${BADGE_CLASS} ${LEVEL_BADGE[check.level]}`}>
                  {LEVEL_LABEL[check.level]}
                </span>
                <span className="w-36 shrink-0 text-gray-800">
                  {check.name}
                </span>
                <span className="min-w-0 break-words text-gray-600">
                  {check.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {info.sections.map((section) => (
          <SectionBlock key={section.id} section={section} />
        ))}

        {/* CPU 性能 (7z b) は QR-Note ベンチマークへ移した (docs/121 §1)。
            計測は押したときだけ走らせる物で、開くたびに集めるこの画面とは性質が違う */}
        <p className="text-sm">
          <Link href="/settings/benchmark" className={ACTION_LINK_CLASS}>
            ベンチマーク →
          </Link>
        </p>
      </div>
    </PageTransition>
  );
}
