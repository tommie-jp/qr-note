"use client";

import Link from "next/link";
import { ItemTimestamps } from "@/components/item/ItemTimestamps";
import { MemoEditor } from "@/components/editor/MemoEditor";
import { NoteSaveForm } from "@/components/editor/NoteSaveForm";
import { RecordAccess } from "@/components/item/RecordAccess";
import { SkeletonBox } from "@/components/chrome/Skeleton";
import { TrashedBanner } from "@/components/trash/TrashedBanner";
import { UnsavedGuard } from "@/components/editor/UnsavedGuard";
import { ACTION_LINK_CLASS } from "@/components/ui";
import { restoreItemsAction, updateItemAction } from "@/lib/client/actions";
import { noteCache } from "@/lib/client/noteStore";
import { formatBase } from "@/lib/editor/saveBase";
import { isIsbn, isJan, isTaggableCode, scanRegisterMemo } from "@/lib/external/scanRegister";

// /edit の本体 (docs/123 §4-4)。本文は控え (GET /api/items/:id) から。
//
// **エディタは本文が届いてから作る。** MemoEditor の defaultValue は最初の
// 1 回しか効かないので、届く前に空で作ると、届いた本文が入らない。
// 一覧やノートから来たときは控えに入っているので待たない
export function EditScreen({ itemId, code }: { itemId: string; code: string | null }) {
  const entry = noteCache.useEntry(itemId);
  const loaded = entry?.value;

  if (loaded === undefined) {
    return entry?.error ? (
      <p role="alert" className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
        ノートを読み込めませんでした: {entry.error.message}
      </p>
    ) : (
      <SkeletonBox className="h-72">ノートを読み込み中…</SkeletonBox>
    );
  }
  const { item } = loaded;

  // スキャンした未登録コードからの新規登録 (docs/10 §5)。既存ノートには効かせない
  // — 別タブで先に保存していた本文を、初期値で黙って上書きしかねない
  const newCode = !item && code && isTaggableCode(code) ? code : null;
  const defaultMemo = newCode ? scanRegisterMemo(newCode) : (item?.memo ?? "");
  // ISBN なら書誌 (docs/13)、JAN なら商品情報 (docs/14) の自動取得を任せる
  const prefill = !newCode
    ? undefined
    : isIsbn(newCode)
      ? ({ kind: "book", code: newCode } as const)
      : isJan(newCode)
        ? ({ kind: "product", code: newCode } as const)
        : undefined;

  return (
    <>
      {/* 編集画面を開いたのも「触った」に数える (docs/37) */}
      <RecordAccess itemId={itemId} />
      {/* 保存しても deletedAt は触らない (復元は明示的な操作だけ) ので、
          ここで知らせないと「編集して更新したのに検索に出ない」になる (docs/12 §5) */}
      {item?.deletedAt && <TrashedBanner itemId={itemId} restoreAction={restoreItemsAction} />}

      {/* 保存は「開いたときの版のままなら書く」(docs/87)。競合したらバナーだけ出す */}
      <NoteSaveForm action={updateItemAction} itemId={itemId} className="space-y-3">
        <UnsavedGuard />
        <MemoEditor
          defaultValue={defaultMemo}
          base={formatBase(item?.updatedAt ?? null)}
          autoFocus
          prefill={prefill}
          draftKey={itemId}
        />
      </NoteSaveForm>

      <ItemTimestamps item={item} />

      <div className="flex gap-1">
        <Link href={`/item/${itemId}`} className={ACTION_LINK_CLASS} transitionTypes={["nav-back"]}>
          表示へ
        </Link>
        <Link href="/" className={ACTION_LINK_CLASS} transitionTypes={["nav-back"]}>
          一覧へ
        </Link>
      </div>
    </>
  );
}
