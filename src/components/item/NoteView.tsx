"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Item } from "@/generated/prisma/client";
import {
  assignNoteNumberAction,
  recordHealthAction,
  restoreItemsAction,
  setItemOfflinePinAction,
  setItemPublicAction,
  toggleMemoTaskAction,
  updateMemoAction,
} from "@/lib/client/actions";
import { ItemTags } from "@/components/item/ItemTags";
import { ItemTimestamps } from "@/components/item/ItemTimestamps";
import {
  EditIcon,
  HistoryIcon,
  NotationIcon,
  PublicIcon,
  QrIcon,
} from "@/components/icons";
import { NoteChromePinToggle } from "@/components/notechrome/NoteChromePinToggle";
import { NoteBody } from "@/components/markdown/NoteBody";
import { MemoPanel } from "@/components/editor/MemoPanel";
import { MemoEditor } from "@/components/editor/MemoEditor";
import { NoteSaveForm } from "@/components/editor/NoteSaveForm";
import { NotePageModeToggle } from "@/components/notepage/NotePageModeToggle";
import { ImageFitScope } from "@/components/markdown/ImageFitScope";
import { ImageFitToggle } from "@/components/markdown/ImageFitToggle";
import { splitPages } from "@/components/notepage/notePages";
import { OfflinePinToggle } from "@/components/item/OfflinePinToggle";
import { NumberAssignButton } from "@/components/item/NumberAssignButton";
import { PendingLink } from "@/components/chrome/PendingLink";
import { PressTip } from "@/components/item/row-actions/PressTip";
import { PublicToggle } from "@/components/item/PublicToggle";
import { SavedToast } from "@/components/chrome/SavedToast";
import { SkeletonBox } from "@/components/chrome/Skeleton";
import { TrashedBanner } from "@/components/trash/TrashedBanner";
import { UnsavedGuard } from "@/components/editor/UnsavedGuard";
import { SavedDraftCleanup } from "@/components/editor/SavedDraftCleanup";
import { PerfMarks } from "@/components/diag/PerfMarks";
import { ACTION_LINK_CLASS, BOX_CLASS } from "@/components/ui";
import {
  circuitsCache,
  noteCache,
  PendingCircuits,
  renderCache,
} from "@/lib/client/noteStore";
import type { PendingCircuitMap } from "@/lib/circuit/types";
import { formatBase } from "@/lib/editor/saveBase";
import { allImageNames } from "@/lib/images/memoImages";
import { hasNoteNumber } from "@/lib/items/noteNumber";
import { perfKB } from "@/lib/logging/perfLine";
import { CIRCUIT_LANGS, HEALTH_LANG, MATRIX_LANG } from "@/lib/markdown/fenceLanguages";
import { ensureSnapshotIndex, snapshotIndexStore } from "@/lib/offline/snapshotIndex";

interface NoteViewProps {
  itemId: string;
  // 更新直後だけ付く保存時刻。トーストを出す印 (docs/11 §2-3)
  saved?: string;
  // デモでは公開・オフライン・履歴・番号を出さない (docs/38 §3)。env は
  // サーバでしか読めないので、器 (ItemDetail) が決めて渡す
  isDemo: boolean;
  // 速度計測の行に載せる器の種類 (page / pane / auto)
  shell: string;
}

// 持ち主 (ログイン中) が見る /item の画面。**端末で描く** (docs/123 §4-1)。
//
// もとはサーバ描画の ItemView で、組み立て (見出し行・通知の束・タブ) は
// そのまま写した。違うのはデータの出どころだけ:
//
//   本文     … 控え (GET /api/items/:id)。一覧から開いたときは一覧の応答で
//              もう入っている。直に開いたときは、届くまで写し (同期データ) の
//              本文を読み取り専用で先に出す
//   回路図   … GET /api/items/:id/circuits。届くまで図の場所にだけ「準備中」
//   表・健康 … GET /api/items/:id/render。そのフェンスを持つノートだけ待つ
//
// 公開ビュー (未ログイン) はサーバ描画のまま (PublicItemView)。
// 本文の描画は両方とも NoteBody を通る
export function NoteView({ itemId, saved, isDemo, shell }: NoteViewProps) {
  const entry = noteCache.useEntry(itemId);
  const loaded = entry?.value;

  if (loaded === undefined) {
    // 届かなかったとき (圏外・サーバの失敗) も、写しがあれば本文は出す
    return (
      <SnapshotPreview
        itemId={itemId}
        error={entry?.error?.message ?? null}
        onRetry={() => noteCache.load(itemId, { force: true })}
      />
    );
  }
  return <LoadedNote itemId={itemId} item={loaded.item} saved={saved} isDemo={isDemo} shell={shell} />;
}

function NoteLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-2 rounded bg-yellow-50 px-3 py-2 text-yellow-800" role="alert">
      <p>ノートを読み込めませんでした: {message}</p>
      <button type="button" onClick={onRetry} className="underline">
        もう一度読み込む
      </button>
    </div>
  );
}

// 控えが届くまで、端末の写しにある本文を先に出す (docs/123 §5)。
// 写しは公開・印・ゴミ箱の状態を持たないので、操作は出さない。
// 取得に失敗したときは断りを添え、写しが無ければ断りだけを出す
function SnapshotPreview({
  itemId,
  error,
  onRetry,
}: {
  itemId: string;
  error: string | null;
  onRetry: () => void;
}) {
  const index = snapshotIndexStore.useStore();
  useEffect(() => {
    ensureSnapshotIndex();
  }, []);
  const item = index?.items.get(itemId);
  if (item === undefined || index === null) {
    return error === null ? (
      <SkeletonBox className="h-72">ノートを読み込み中…</SkeletonBox>
    ) : (
      <NoteLoadError message={error} onRetry={onRetry} />
    );
  }
  return (
    <div className="space-y-3" aria-busy={error === null}>
      {error !== null && <NoteLoadError message={`${error} (端末に持ち出した版を出しています)`} onRetry={onRetry} />}
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold">item</h1>
        {error === null && <span className="text-sm text-gray-500">読み込み中…</span>}
      </div>
      <ItemTags tags={item.tags} />
      <div className={BOX_CLASS}>
        <NoteBody memo={item.memo} circuits={index.circuits} />
      </div>
    </div>
  );
}

// フェンスを持つかの粗い判定。**行頭に縛らない** — 引用 (`> `) や箇条書きの
// 中のフェンスも描かれるので、縛ると図が出ない。取りすぎ (本文中の文字列に
// 当たる) は 1 回余分に引くだけで済む
const NEEDS_RENDER = new RegExp(`(?:\`{3,}|~{3,})\\s*(?:${MATRIX_LANG}|${HEALTH_LANG})\\b`);
// 回路図のフェンスを持つか。持たないノートでは /circuits を引かない
const HAS_CIRCUIT = new RegExp(`(?:\`{3,}|~{3,})\\s*(?:${CIRCUIT_LANGS.join("|")})\\b`);
const NO_CIRCUITS: PendingCircuitMap = new Map();

// 回路図の表。描き終えた控えがあればそれを、無ければ「届いたら解ける約束」の
// 表を渡す。古い控え (書き換えの後) は約束の表の初期値にして、変わっていない
// 図は待たせない
function useCircuits(itemId: string, memo: string): PendingCircuitMap {
  const wants = HAS_CIRCUIT.test(memo);
  const entry = circuitsCache.useEntry(wants ? itemId : null);
  const fresh = entry !== undefined && entry.value !== undefined && !entry.stale ? entry.value : null;
  const staleValue = entry?.value;
  return useMemo(() => {
    if (!wants) {
      return NO_CIRCUITS;
    }
    if (fresh !== null) {
      return fresh;
    }
    const pending = new PendingCircuits(circuitsCache.load(itemId));
    for (const [key, result] of staleValue ?? []) {
      pending.set(key, result);
    }
    return pending;
    // memo が変われば図の鍵も変わるので作り直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, memo, fresh, wants]);
}

function LoadedNote({
  itemId,
  item,
  saved,
  isDemo,
  shell,
}: {
  itemId: string;
  item: Item | null;
  saved?: string;
  isDemo: boolean;
  shell: string;
}) {
  const memo = item?.memo ?? "";
  const circuits = useCircuits(itemId, memo);
  // 表・健康のフェンスを持つノートだけ集計を引く。持たないノートは
  // オフラインの印の吹き出しに出す添付量だけ (印を出すときだけ)
  const needsFullRender = NEEDS_RENDER.test(memo);
  const showsPin = item !== null && !isDemo;
  const render = renderCache.useEntry(
    needsFullRender ? { itemId, full: true } : showsPin ? { itemId, full: false } : null,
  )?.value;

  // 区切りを書いていないノートにはページの切り替えを出さない (ItemView と同じ)
  const hasPages = useMemo(() => splitPages(memo).length > 1, [memo]);
  const hasImages = useMemo(() => allImageNames(memo).length > 0, [memo]);
  // 表・グラフを持つノートだけ、集計が届くまで本文を待たせる。持たない
  // ノートで待つと、使わない集計のために本文が遅れる
  const waitsForRender = needsFullRender && render === undefined;

  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
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
              attachmentBytes={render?.attachmentBytes ?? 0}
              setPinAction={setItemOfflinePinAction}
            />
          </>
        )}
      </div>
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
    </div>
  );

  // 出たときだけ間隔を持つ通知の束 (ItemView と同じ。&& ではなく三項で null)
  const notices = (
    <div className="space-y-3 py-3 empty:hidden">
      {!item ? (
        <p className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
          未登録の部品番号です。メモを保存すると新規登録されます。
        </p>
      ) : null}
      {item?.deletedAt ? <TrashedBanner itemId={itemId} restoreAction={restoreItemsAction} /> : null}
    </div>
  );

  const badge: ReactNode = item?.publicAt ? (
    <span
      role="img"
      aria-label="公開中"
      title="公開中 — この URL を知っていれば誰でも見られます"
      className="inline-flex size-8 items-center justify-center rounded-full bg-green-50 text-green-800"
    >
      <PublicIcon />
    </span>
  ) : null;

  return (
    <div>
      {saved && <SavedToast key={saved} />}
      {saved && <SavedDraftCleanup draftKey={itemId} />}
      <NotePerf itemId={itemId} memo={memo} shell={shell} circuits={circuits.size} ready={!waitsForRender} />

      <MemoPanel
        key={itemId}
        chrome={{
          heading,
          notices,
          tags: item ? <ItemTags tags={item.tags} /> : null,
          footer: <ItemTimestamps item={item} />,
          badge,
        }}
        defaultMode={memo ? "markdown" : "edit"}
        markdownView={
          <ImageFitScope>
            {waitsForRender ? (
              <SkeletonBox className="h-72">本文を読み込み中…</SkeletonBox>
            ) : (
              <NoteBody
                memo={memo}
                circuits={circuits}
                matrices={render?.matrices}
                health={render?.health}
                allowRotate
                allowSecretEdit
                onToggleTask={toggleMemoTaskAction.bind(null, itemId)}
                onRecordHealth={recordHealthAction.bind(null, itemId)}
              />
            )}
          </ImageFitScope>
        }
        textView={
          <pre className={`whitespace-pre-wrap break-words ${BOX_CLASS} font-mono text-base`}>{memo}</pre>
        }
        editForm={
          <NoteSaveForm action={updateMemoAction} itemId={itemId} className="space-y-3">
            <UnsavedGuard />
            <MemoEditor
              defaultValue={memo}
              base={formatBase(item?.updatedAt ?? null)}
              minHeight="18rem"
              autoFocus={memo === ""}
              draftKey={itemId}
            />
          </NoteSaveForm>
        }
      />
    </div>
  );
}

// 速度計測の印 (docs/119 §2-2)。本文が描ける所まで来た = ノートが開いた。
// サーバ描画の頃はサーバの段階を載せていたが、端末で描くので器と本文の量だけ
function NotePerf({
  itemId,
  memo,
  shell,
  circuits,
  ready,
}: {
  itemId: string;
  memo: string;
  shell: string;
  circuits: number;
  ready: boolean;
}) {
  // 印の時刻は器を作ったときに 1 度だけ決める (同じ印を二度使わない鍵)
  const [at] = useState(() => Date.now());
  const fields = useMemo(
    () =>
      [
        ["id", itemId.slice(-8)],
        ["器", shell],
        ["本文", perfKB(new TextEncoder().encode(memo).length)],
        ["画像", allImageNames(memo).length],
        ["回路", circuits],
      ] as const,
    [itemId, shell, memo, circuits],
  );
  if (!ready) {
    return null;
  }
  return <PerfMarks kind="ノート" itemId={itemId} at={at} fields={fields} server="端末" />;
}
