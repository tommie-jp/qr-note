"use client";

import Link from "next/link";
import type { Item } from "@/generated/prisma/client";
import {
  assignNoteNumberAction,
  restoreItemsAction,
  setItemOfflinePinAction,
  setItemPublicAction,
} from "@/lib/client/actions";
import {
  EditIcon,
  HistoryIcon,
  NotationIcon,
  PublicIcon,
  QrIcon,
} from "@/components/icons";
import { NoteChromePinToggle } from "@/components/notechrome/NoteChromePinToggle";
import { NotePageModeToggle } from "@/components/notepage/NotePageModeToggle";
import { ImageFitToggle } from "@/components/markdown/ImageFitToggle";
import { OfflinePinToggle } from "@/components/item/OfflinePinToggle";
import { NumberAssignButton } from "@/components/item/NumberAssignButton";
import { PendingLink } from "@/components/chrome/PendingLink";
import { PressTip } from "@/components/item/row-actions/PressTip";
import { PublicToggle } from "@/components/item/PublicToggle";
import { TrashedBanner } from "@/components/trash/TrashedBanner";
import { ACTION_LINK_CLASS } from "@/components/ui";
import { hasNoteNumber } from "@/lib/items/noteNumber";

// /item の画面 (NoteView) の見出し行・通知の束・公開中の印。
// MemoPanel の chrome に渡す部品で、組み立てはサーバ描画の ItemView から写した

export interface NoteHeadingProps {
  itemId: string;
  item: Item | null;
  isDemo: boolean;
  // オフラインの印の吹き出しに出す添付量。数え終わるまでは undefined
  attachmentBytes: number | undefined;
  hasPages: boolean;
  hasImages: boolean;
}

export function NoteHeading(props: NoteHeadingProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <NoteHeadingToggles {...props} />
      <NoteHeadingActions {...props} />
    </div>
  );
}

function NoteHeadingToggles({
  itemId,
  item,
  isDemo,
  attachmentBytes,
}: NoteHeadingProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="text-xl font-bold">item</h1>
      {/* 未登録のノートにはトグルを出さない。デモでは公開とオフラインを
          封じるので出さない (docs/22 §7・docs/38 §3) */}
      {item && !isDemo && (
        <>
          <PublicToggle
            itemId={itemId}
            publicAt={item.publicAt}
            setPublicAction={setItemPublicAction}
          />
          {/* 添付の量は吹き出しの文言にしか使わないので、数え終わるまでは 0 */}
          <OfflinePinToggle
            itemId={itemId}
            pinned={item.offlinePin}
            attachmentBytes={attachmentBytes ?? 0}
            setPinAction={setItemOfflinePinAction}
          />
        </>
      )}
    </div>
  );
}

function NoteHeadingActions({
  itemId,
  item,
  isDemo,
  hasPages,
  hasImages,
}: NoteHeadingProps) {
  return (
    <div className="flex flex-wrap gap-1">
      <PressTip label="このノートを編集する">
        <Link href={`/edit/${itemId}`} className={ACTION_LINK_CLASS} transitionTypes={["nav-forward"]}>
          <EditIcon />
          編集
        </Link>
      </PressTip>
      {!isDemo && (
        <PressTip label="いつ何を書き換えたかを見る">
          <Link
            href={`/item/${itemId}/history`}
            className={ACTION_LINK_CLASS}
            transitionTypes={["nav-forward"]}
          >
            <HistoryIcon />
            履歴
          </Link>
        </PressTip>
      )}
      {item && !hasNoteNumber(item.tags) && !isDemo && (
        <NumberAssignButton itemId={itemId} assignAction={assignNoteNumberAction} />
      )}
      <PressTip label="QR シールを印刷する">
        <PendingLink href={`/print/${itemId}`} className={ACTION_LINK_CLASS} transitionTypes={["nav-forward"]}>
          <QrIcon />
          QR
        </PendingLink>
      </PressTip>
      {hasPages && <NotePageModeToggle />}
      {hasImages && <ImageFitToggle />}
      <PressTip label="メモ記法の書き方を見る">
        <Link href="/docs/memo" className={ACTION_LINK_CLASS} transitionTypes={["nav-forward"]}>
          <NotationIcon />
          記法
        </Link>
      </PressTip>
      <NoteChromePinToggle />
    </div>
  );
}

// 出たときだけ間隔を持つ通知の束 (ItemView と同じ。&& ではなく三項で null)
export function NoteNotices({ itemId, item }: { itemId: string; item: Item | null }) {
  return (
    <div className="space-y-3 py-3 empty:hidden">
      {!item ? (
        <p className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
          未登録の部品番号です。メモを保存すると新規登録されます。
        </p>
      ) : null}
      {item?.deletedAt ? <TrashedBanner itemId={itemId} restoreAction={restoreItemsAction} /> : null}
    </div>
  );
}

// 公開中の印 (公開していないノートでは呼び手が null を渡す)
export function PublicBadge() {
  return (
    <span
      role="img"
      aria-label="公開中"
      title="公開中 — この URL を知っていれば誰でも見られます"
      className="inline-flex size-8 items-center justify-center rounded-full bg-green-50 text-green-800"
    >
      <PublicIcon />
    </span>
  );
}
