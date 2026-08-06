import Link from "next/link";
import { notFound } from "next/navigation";
import { restoreNoteVersionAction } from "@/app/actions";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { NoteDiffView } from "@/components/NoteDiffView";
import { PageTransition } from "@/components/PageTransition";
import { ACTION_LINK_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/ui";
import { isDemoMode } from "@/lib/appEnv";
import { formatJstDateTime } from "@/lib/datetime";
import { isValidCommitOid } from "@/lib/git/notePath";
import { noteAtCommit, noteHistory } from "@/lib/git/notesRepo";
import { requireUser } from "@/lib/session";
import { isValidItemNo } from "@/lib/validation";

export const dynamic = "force-dynamic";

interface VersionPageProps {
  params: Promise<{ itemNo: string; oid: string }>;
}

// 1 コミットの詳細: その版で何が変わったか (親の版との差分) と復元
// (docs/57-ノートgit履歴計画.md §5)。proxy.ts も未ログインを止めるパス形
// (完全一致に当たらない) だが、履歴一覧と同じく requireUser() を重ねる —
// proxy は楽観的な検査であって唯一の砦にしない (docs/18 §4)。
export default async function VersionPage({ params }: VersionPageProps) {
  const { itemNo, oid } = await params;
  if (!isValidItemNo(itemNo) || !isValidCommitOid(oid) || isDemoMode()) {
    notFound();
  }
  await requireUser();

  // このノートの履歴に載っている oid だけを受ける。リポジトリは全ノート
  // 共有なので、履歴経由に限定して「別ノートのコミットを URL に差し込んで
  // 開く」道をここで閉じる (シングルユーザーでも行儀として)
  const history = await noteHistory(itemNo);
  const entry = history.find((commit) => commit.oid === oid);
  if (entry === undefined) {
    notFound();
  }

  // 差分の比較元は親の版。初コミット (親なし) は空文字列 = 全文が追加
  const [content, parentContent] = await Promise.all([
    noteAtCommit(itemNo, oid),
    entry.parentOid === null ? null : noteAtCommit(itemNo, entry.parentOid),
  ]);

  return (
    <PageTransition>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold">
            履歴 <span className="font-mono">#{itemNo}</span>{" "}
            <span className="font-mono text-sm font-normal text-gray-400">
              {oid.slice(0, 7)}
            </span>
          </h1>
          <div className="flex gap-1">
            <Link
              href={`/item/${itemNo}/history`}
              className={ACTION_LINK_CLASS}
              transitionTypes={["nav-back"]}
            >
              履歴一覧へ
            </Link>
          </div>
        </div>

        <p>
          <span className="font-medium">{entry.message}</span>{" "}
          <span className="text-sm text-gray-500">
            {formatJstDateTime(new Date(entry.date))}
          </span>
        </p>

        {/* 墓石コミット (永久削除)。本文が無いので差分は「全行削除」に見える */}
        {content === null && (
          <p className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
            この版でノートは削除されました。
          </p>
        )}

        <NoteDiffView oldText={parentContent ?? ""} newText={content ?? ""} />

        {content !== null && (
          <form>
            <input type="hidden" name="itemNo" value={itemNo} />
            <input type="hidden" name="oid" value={oid} />
            {/* 復元は本文の上書き (未コミットの変更は消える) なので確認を挟む。
                復元そのものは DB だけを書き、履歴は増えない
                (restoreNoteVersionAction のコメント参照) */}
            <ConfirmSubmitButton
              confirmMessage={`#${itemNo} の本文をこの版の内容で置き換えます。いまの本文のうち未コミットの変更は失われます。よろしいですか?`}
              formAction={restoreNoteVersionAction}
              className={SECONDARY_BUTTON_CLASS}
            >
              この版に復元
            </ConfirmSubmitButton>
          </form>
        )}
      </div>
    </PageTransition>
  );
}
