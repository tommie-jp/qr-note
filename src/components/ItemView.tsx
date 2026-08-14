import Link from "next/link";
import type { Item } from "@/generated/prisma/client";
import {
  recordHealthAction,
  restoreItemsAction,
  setItemOfflinePinAction,
  setItemPublicAction,
  toggleMemoTaskAction,
  updateMemoAction,
} from "@/app/actions";
import { ItemTags } from "@/components/ItemTags";
import { ItemTimestamps } from "@/components/ItemTimestamps";
import { ItemUrlBox } from "@/components/ItemUrlBox";
import { NoteBody } from "@/components/NoteBody";
import { MemoPanel } from "@/components/MemoPanel";
import { MemoEditor } from "@/components/MemoEditor";
import { OfflinePinToggle } from "@/components/OfflinePinToggle";
import { PendingLink } from "@/components/PendingLink";
import { PublicToggle } from "@/components/PublicToggle";
import { SavedToast } from "@/components/SavedToast";
import { TrashedBanner } from "@/components/TrashedBanner";
import { UnsavedGuard } from "@/components/UnsavedGuard";
import { ACTION_LINK_CLASS, BOX_CLASS } from "@/components/ui";
import { isDemoMode } from "@/lib/appEnv";
import { renderCircuits } from "@/lib/circuitCache";
import { buildHealthCharts } from "@/lib/healthData";
import { buildMatrices } from "@/lib/matrixData";
import { pinAttachmentBytes } from "@/lib/offline/pinSize";

interface ItemViewProps {
  itemNo: string;
  item: Item | null;
  // 更新直後だけ付く保存時刻。トーストを出す印 (docs/11 §2-3)
  saved?: string;
}

// 持ち主 (ログイン中) が見る /item の画面。
//
// ログインしていない人が見るのは PublicItemView のほう (docs/22-ノート公開計画.md §4)。
// 分岐は page.tsx が持ち、ここは「ログイン済み」だけを考える。
//
// Ver1 と同じく未登録の itemNo でも開けて、その場で memo を書いて新規作成できる
// (QR シールを先に貼っておける)。
export async function ItemView({ itemNo, item, saved }: ItemViewProps) {
  const memo = item?.memo ?? "";
  // ```circuitikz は TeX (WASM) で描くため非同期。MarkdownView は同期に描くので
  // ここで済ませて結果を渡す (2 回目以降は DB キャッシュを引くだけ)。
  //
  // 印を付けたときに落ちる量も一緒に数える。どちらも memo だけから決まる
  // 独立な問い合わせなので並べる (直列にすると描画が待つ分だけ遅くなる)
  const [circuits, attachmentBytes, matrices, health] = await Promise.all([
    renderCircuits(memo),
    pinAttachmentBytes(memo),
    // ```matrix の集計。**ここ (ログイン済みの画面) からしか渡さない** —
    // 公開ビューは回路図のために renderCircuits を呼んでいるので、
    // 並べて置くと非公開ノートの一覧が匿名の閲覧者に漏れる (docs/77 §6)
    buildMatrices(memo),
    // ```health の集計も同じ (docs/83 §8)。こちらは体重・体温が並ぶので、
    // 漏れたときの取り返しは学習状況よりつかない
    buildHealthCharts(memo),
  ]);

  return (
    // 縦に隙間を持たない (docs/75-ノート上部圧縮計画.md §4)。見出し行・タグ・
    // 本文パネルは地続きに積み、間隔が要る物 (通知の束・タイムスタンプ) だけが
    // 自分で余白を持つ。space-y-4 のままだと、出ていない要素の分まで縦が空く
    <div>
      {/* flex-wrap … テキストサイズ (docs/61) を上げると見出しと操作リンク
          (編集 / 履歴 / QR / 記法) が 1 行に収まらない。折り返さないと画面ごと
          横スクロールになるので、2 行になるほうを取る (ヘッダーの帯と同じ判断)。
          items-center … 枠付きのトグルは baseline で揃えると沈む */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">
            item <span className="font-mono">#{itemNo}</span>
          </h1>
          {/* 未登録のノートにはトグルを出さない。まだ公開する中身がない
              (docs/22 §7)。デモモードでは公開機能を封じるのでトグル自体を
              出さない (docs/38-デモモード計画.md §3。Server Action 側でも
              塞いでいる)。オフラインの印も同じ判断 — デモは同期の口ごと
              閉じてある (api/sync/items) ので、押せても何も起きない */}
          {item && !isDemoMode() && (
            <>
              <PublicToggle
                itemNo={itemNo}
                publicAt={item.publicAt}
                setPublicAction={setItemPublicAction}
              />
              <OfflinePinToggle
                itemNo={itemNo}
                pinned={item.offlinePin}
                attachmentBytes={attachmentBytes}
                setPinAction={setItemOfflinePinAction}
              />
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <Link
            href={`/edit/${itemNo}`}
            className={ACTION_LINK_CLASS}
            transitionTypes={["nav-forward"]}
          >
            編集
          </Link>
          {/* git 履歴 (docs/57-ノートgit履歴計画.md)。デモでは機能ごと閉じる
              のでリンクも出さない (PublicToggle と同じ判断) */}
          {!isDemoMode() && (
            <Link
              href={`/item/${itemNo}/history`}
              className={ACTION_LINK_CLASS}
              transitionTypes={["nav-forward"]}
            >
              履歴
            </Link>
          )}
          {/* /print は loading.tsx を持たない force-dynamic なページなので、
              押してから画面が変わるまでの間はリンク側でスピナーを出す */}
          <PendingLink
            href={`/print/${itemNo}`}
            className={ACTION_LINK_CLASS}
            transitionTypes={["nav-forward"]}
          >
            QR
          </PendingLink>
          <Link
            href="/docs/memo"
            className={ACTION_LINK_CLASS}
            transitionTypes={["nav-forward"]}
          >
            記法
          </Link>
        </div>
      </div>

      {/* 画面下部に浮くトーストなので、下の「通知の束」には入れない。
          入れると fixed で場所を取らないのに束が空でなくなり、消えるまでの
          2 秒だけ余白が開いて、消えた瞬間に本文が跳ね上がる */}
      {saved && <SavedToast key={saved} />}

      {/* 出たときだけ間隔を持つ通知の束。1 つも出なければ empty:hidden で
          箱ごと消え、余白も残らない。
          **&& ではなく三項で null を返す**のが要点 — item.url が空文字だと
          && は "" を返し、空のテキストノードで :empty が外れて余白だけが残る */}
      <div className="space-y-3 py-3 empty:hidden">
        {!item ? (
          <p className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
            未登録の部品番号です。メモを保存すると新規登録されます。
          </p>
        ) : null}
        {item?.deletedAt ? (
          <TrashedBanner itemNo={itemNo} restoreAction={restoreItemsAction} />
        ) : null}
        {item?.url ? <ItemUrlBox url={item.url} /> : null}
      </div>

      {item && <ItemTags tags={item.tags} />}

      {/* key: item 間のソフトナビゲーションでタブ選択状態を持ち越さない */}
      <MemoPanel
        key={itemNo}
        defaultMode={memo ? "markdown" : "edit"}
        markdownView={
          <NoteBody
            memo={memo}
            circuits={circuits}
            matrices={matrices}
            health={health}
            allowRotate
            allowSecretEdit
            onToggleTask={toggleMemoTaskAction.bind(null, itemNo)}
            onRecordHealth={recordHealthAction.bind(null, itemNo)}
          />
        }
        textView={
          <pre
            className={`whitespace-pre-wrap break-words ${BOX_CLASS} font-mono text-base`}
          >
            {memo}
          </pre>
        }
        editForm={
          <form action={updateMemoAction} className="space-y-3">
            <UnsavedGuard />
            <input type="hidden" name="itemNo" value={itemNo} />
            <MemoEditor
              defaultValue={memo}
              minHeight="18rem"
              autoFocus={memo === ""}
            />
            {/* 「更新」は画面下部の操作バーへ移した (MemoEditorInner が portal で
                差し込む)。この form の子孫のまま送信される */}
          </form>
        }
      />

      {/* 本文と地続きだと日時が本文の続きに見えるので、ここだけ間隔を残す。
          余白は使う側が持つ — ItemTimestamps 自体は /edit と公開ビューでも
          使われており、そちらの積み方まで動かしたくない */}
      <div className="mt-4">
        <ItemTimestamps item={item} />
      </div>
    </div>
  );
}
