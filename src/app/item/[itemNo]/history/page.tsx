import Link from "next/link";
import { notFound } from "next/navigation";
import { commitNoteAction } from "@/app/actions";
import { NoteDiffView } from "@/components/NoteDiffView";
import { PageTransition } from "@/components/PageTransition";
import {
  ACTION_LINK_CLASS,
  BOX_CLASS,
  PRIMARY_BUTTON_CLASS,
} from "@/components/ui";
import { isDemoMode } from "@/lib/appEnv";
import { formatJstDateTime } from "@/lib/datetime";
import { noteAtHead, noteHistory } from "@/lib/git/notesRepo";
import { getItem } from "@/lib/items";
import { requireUser } from "@/lib/session";
import { isValidItemNo } from "@/lib/validation";

export const dynamic = "force-dynamic";

interface HistoryPageProps {
  params: Promise<{ itemNo: string }>;
  // done … commitNoteAction の結果 (committed = 刻んだ / noop = 変化なし)
  searchParams: Promise<{ done?: string }>;
}

// ノートのコミット履歴 (docs/57-ノートgit履歴計画.md §5)。
//
// このパスは publicPaths.ts の完全一致判定に当たらないので、proxy.ts が
// 未ログインを止める (/edit と同じ構図)。公開ノートでも履歴は見せない —
// 公開したのは現在の本文だけで、過去の版まで公開した覚えはないため。
// それでも requireUser() を重ねるのは settings 系と同じ判断 — proxy は
// 楽観的な検査であって唯一の砦にしない (docs/18 §4)。この画面が晒すのは
// 永久削除済みの本文まで含む全履歴で、非公開ページの中でも機微度が高い。
export default async function HistoryPage({
  params,
  searchParams,
}: HistoryPageProps) {
  const { itemNo } = await params;
  // デモは履歴機能ごと閉じる (docs/57 §4)。リンクも出していないので 404 でよい
  if (!isValidItemNo(itemNo) || isDemoMode()) {
    notFound();
  }
  await requireUser();

  const [item, history, headMemo, { done }] = await Promise.all([
    getItem(itemNo),
    noteHistory(itemNo),
    noteAtHead(itemNo),
    searchParams,
  ]);

  // 未登録で履歴もない番号には何もない (/item と違い、書き始める場でもない)
  if (item === null && history.length === 0) {
    notFound();
  }

  // 「未コミット」= DB のいまの本文 (正本) と HEAD の本文の差。
  // 一度もコミットしていないノートは空文字列と比べる (全文が「追加」に見える)
  const memo = item?.memo ?? null;
  const hasUncommitted = memo !== null && memo !== (headMemo ?? "");

  return (
    <PageTransition>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold">
            履歴 <span className="font-mono">#{itemNo}</span>
          </h1>
          <div className="flex gap-1">
            <Link
              href={`/item/${itemNo}`}
              className={ACTION_LINK_CLASS}
              transitionTypes={["nav-back"]}
            >
              表示へ
            </Link>
          </div>
        </div>

        {/* commitNoteAction の結果。リロードで再実行されない ?done= 方式
            (settings/history と同じ)。noop は描画と送信の間に別タブが同じ
            内容を先にコミットしたときで、入力したメッセージは使われていない */}
        {done === "committed" && (
          <p className="rounded bg-green-50 px-3 py-2 text-green-800">
            コミットしました。
          </p>
        )}
        {done === "noop" && (
          <p className="rounded bg-gray-100 px-3 py-2 text-gray-600">
            変更がなかったため、コミットしませんでした。
          </p>
        )}

        {/* 永久削除済みでも履歴があればここへ来られる (本文の回収口。docs/57 §4)。
            版を開いて復元すると upsert で新しいノートとして蘇る */}
        {item === null && (
          <p className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
            このノートは削除済みです。過去の版を開くと本文を確認・復元できます。
          </p>
        )}

        {hasUncommitted && (
          <section className="space-y-2">
            <h2 className="font-medium">未コミットの変更</h2>
            <NoteDiffView oldText={headMemo ?? ""} newText={memo ?? ""} />
            <form action={commitNoteAction} className="flex gap-2">
              <input type="hidden" name="itemNo" value={itemNo} />
              {/* 本文は送らない。コミットされるのは DB のいまの本文
                  (commitNoteAction のコメント参照) */}
              <input
                name="message"
                maxLength={200}
                placeholder={`update ${itemNo}`}
                aria-label="コミットメッセージ"
                className={`${BOX_CLASS} min-w-0 flex-1`}
              />
              <button type="submit" className={PRIMARY_BUTTON_CLASS}>
                コミット
              </button>
            </form>
          </section>
        )}
        {!hasUncommitted && item !== null && (
          <p className="text-sm text-gray-500">未コミットの変更はありません。</p>
        )}

        <section className="space-y-2">
          <h2 className="font-medium">コミット履歴</h2>
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">まだコミットがありません。</p>
          ) : (
            <ul className={`${BOX_CLASS} divide-y divide-gray-200`}>
              {history.map((commit) => (
                <li key={commit.oid}>
                  <Link
                    href={`/item/${itemNo}/history/${commit.oid}`}
                    className="flex min-h-11 flex-wrap items-center gap-x-3 py-2 text-blue-600 transition-colors active:bg-blue-50"
                    transitionTypes={["nav-forward"]}
                  >
                    <span className="font-medium">{commit.message}</span>
                    <span className="text-sm text-gray-500">
                      {formatJstDateTime(new Date(commit.date))}
                    </span>
                    <span className="font-mono text-xs text-gray-400">
                      {commit.oid.slice(0, 7)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageTransition>
  );
}
