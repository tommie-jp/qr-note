"use client";

import { useEffect, useMemo, useState } from "react";
import type { Item } from "@/generated/prisma/client";
import { updateMemoAction } from "@/lib/client/actions";
import { ItemTags } from "@/components/item/ItemTags";
import { ItemTimestamps } from "@/components/item/ItemTimestamps";
import { NoteBody } from "@/components/markdown/NoteBody";
import { MemoPanel } from "@/components/editor/MemoPanel";
import { MemoEditor } from "@/components/editor/MemoEditor";
import { NoteSaveForm } from "@/components/editor/NoteSaveForm";
import { ImageFitScope } from "@/components/markdown/ImageFitScope";
import type { ToggleTaskHandler } from "@/components/markdown/TaskCheckbox";
import type { RecordHealthHandler } from "@/components/health/HealthRecordForm";
import { splitPages } from "@/components/notepage/notePages";
import { SavedToast } from "@/components/chrome/SavedToast";
import { SkeletonBox } from "@/components/chrome/Skeleton";
import { UnsavedGuard } from "@/components/editor/UnsavedGuard";
import { SavedDraftCleanup } from "@/components/editor/SavedDraftCleanup";
import { PerfMarks } from "@/components/diag/PerfMarks";
import { BOX_CLASS } from "@/components/ui";
import {
  circuitsCache,
  noteCache,
  PendingCircuits,
} from "@/lib/client/noteStore";
import type { PendingCircuitMap } from "@/lib/circuit/types";
import type { HealthMap } from "@/lib/health/healthData";
import type { MatrixMap } from "@/lib/matrix/matrixData";
import { formatBase } from "@/lib/editor/saveBase";
import { allImageNames } from "@/lib/images/memoImages";
import { perfKB } from "@/lib/perf/perfLine";
import { CIRCUIT_LANGS } from "@/lib/markdown/fenceLanguages";
import { ensureSnapshotIndex, snapshotIndexStore } from "@/lib/offline/snapshotIndex";
import {
  NoteHeading,
  type NoteHeadingProps,
  NoteNotices,
  PublicBadge,
} from "./NoteHeading";
import { useNoteActions, useNoteRender, useNoteTabs } from "./useLoadedNote";

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

// フェンスを持つかの粗い判定は useLoadedNote.ts の NEEDS_RENDER と同じ流儀
// (行頭に縛らない。取りすぎは 1 回余分に引くだけ)
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
    // 依存は意図して実際の読み取りとずらしてある (docs/128 §8-2 で残すと決めた)。
    //   memo を入れる … 本文が変われば図の鍵も変わるので、約束の表を作り直して
    //                   取り直す (中では読まないが、作り直しの合図に使う)
    //   staleValue を入れない … 古い控えは約束の表の初期値に使うだけで、
    //                   差し替わっても作り直す理由にならない (fresh が替われば作り直す)
    // 鍵の値を別に作っても「読まない依存」が残るだけなので、ここは抑止で書く
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, memo, fresh, wants]);
}

interface LoadedNoteProps {
  itemId: string;
  item: Item | null;
  saved?: string;
  isDemo: boolean;
  shell: string;
}

function LoadedNote({ itemId, item, saved, isDemo, shell }: LoadedNoteProps) {
  const memo = item?.memo ?? "";
  const circuits = useCircuits(itemId, memo);
  const { extraTabs, openedTab } = useNoteTabs(itemId, item);
  const { onToggleTask, onRecordHealth } = useNoteActions(itemId);
  const showsPin = item !== null && !isDemo;
  const { render, waitsForRender } = useNoteRender(itemId, memo, showsPin);

  // 区切りを書いていないノートにはページの切り替えを出さない (ItemView と同じ)
  const hasPages = useMemo(() => splitPages(memo).length > 1, [memo]);
  const hasImages = useMemo(() => allImageNames(memo).length > 0, [memo]);

  return (
    <div>
      {saved && <SavedToast key={saved} />}
      {saved && <SavedDraftCleanup draftKey={itemId} />}
      <NotePerf itemId={itemId} memo={memo} shell={shell} circuits={circuits.size} ready={!waitsForRender} />

      <MemoPanel
        key={itemId}
        chrome={noteChrome({
          itemId,
          item,
          isDemo,
          attachmentBytes: render?.attachmentBytes,
          hasPages,
          hasImages,
        })}
        extraTabs={extraTabs}
        defaultMode={defaultModeOf(extraTabs, openedTab, memo)}
        markdownView={
          <NoteMarkdown
            memo={memo}
            circuits={circuits}
            render={render}
            waitsForRender={waitsForRender}
            onToggleTask={onToggleTask}
            onRecordHealth={onRecordHealth}
          />
        }
        textView={
          <pre className={`whitespace-pre-wrap break-words ${BOX_CLASS} font-mono text-base`}>{memo}</pre>
        }
        editForm={<NoteEditForm itemId={itemId} item={item} memo={memo} />}
      />
    </div>
  );
}

// MemoPanel の枠に置く部品 (見出し行・通知の束・タグ・時刻・公開中の印)
function noteChrome(props: NoteHeadingProps) {
  const { itemId, item } = props;
  return {
    heading: <NoteHeading {...props} />,
    notices: <NoteNotices itemId={itemId} item={item} />,
    tags: item ? <ItemTags tags={item.tags} /> : null,
    footer: <ItemTimestamps item={item} />,
    badge: item?.publicAt ? <PublicBadge /> : null,
  };
}

// 開いたときの ?tab= がモジュールのタブならそれを、無ければ本文があれば表示、
// 空なら編集から始める
function defaultModeOf(extraTabs: readonly { key: string }[], openedTab: string | null, memo: string) {
  return extraTabs.some(({ key }) => key === openedTab) ? openedTab ?? "markdown" : memo ? "markdown" : "edit";
}

function NoteMarkdown({
  memo,
  circuits,
  render,
  waitsForRender,
  onToggleTask,
  onRecordHealth,
}: {
  memo: string;
  circuits: PendingCircuitMap;
  render: { matrices?: MatrixMap; health?: HealthMap } | undefined;
  waitsForRender: boolean;
  onToggleTask: ToggleTaskHandler;
  onRecordHealth: RecordHealthHandler;
}) {
  return (
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
          onToggleTask={onToggleTask}
          onRecordHealth={onRecordHealth}
        />
      )}
    </ImageFitScope>
  );
}

function NoteEditForm({ itemId, item, memo }: { itemId: string; item: Item | null; memo: string }) {
  return (
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
