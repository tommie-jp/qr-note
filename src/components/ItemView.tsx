import Link from "next/link";
import type { Item } from "@/generated/prisma/client";
import {
  restoreItemsAction,
  setItemPublicAction,
  updateMemoAction,
} from "@/app/actions";
import { ItemTags } from "@/components/ItemTags";
import { ItemTimestamps } from "@/components/ItemTimestamps";
import { ItemUrlBox } from "@/components/ItemUrlBox";
import { MarkdownView } from "@/components/MarkdownView";
import { MemoPanel } from "@/components/MemoPanel";
import { MemoEditor } from "@/components/MemoEditor";
import { PendingLink } from "@/components/PendingLink";
import { PublicToggle } from "@/components/PublicToggle";
import { SavedToast } from "@/components/SavedToast";
import { TrashedBanner } from "@/components/TrashedBanner";
import { UnsavedGuard } from "@/components/UnsavedGuard";
import { ACTION_LINK_CLASS, BOX_CLASS } from "@/components/ui";
import { isDemoMode } from "@/lib/appEnv";
import { renderCircuits } from "@/lib/circuitCache";

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
  // ここで済ませて結果を渡す (2 回目以降は DB キャッシュを引くだけ)
  const circuits = await renderCircuits(memo);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">
          item <span className="font-mono">#{itemNo}</span>
        </h1>
        <div className="flex gap-1">
          <Link
            href={`/edit/${itemNo}`}
            className={ACTION_LINK_CLASS}
            transitionTypes={["nav-forward"]}
          >
            編集
          </Link>
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

      {saved && <SavedToast key={saved} />}

      {!item && (
        <p className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
          未登録の部品番号です。メモを保存すると新規登録されます。
        </p>
      )}

      {item?.deletedAt && (
        <TrashedBanner itemNo={itemNo} restoreAction={restoreItemsAction} />
      )}

      {/* 未登録のノートにはトグルを出さない。まだ公開する中身がない (docs/22 §7)。
          デモモードでは公開機能を封じるのでトグル自体を出さない
          (docs/38-デモモード計画.md §3。Server Action 側でも塞いでいる) */}
      {item && !isDemoMode() && (
        <PublicToggle
          itemNo={itemNo}
          publicAt={item.publicAt}
          setPublicAction={setItemPublicAction}
        />
      )}

      {item && item.url && <ItemUrlBox url={item.url} />}

      {item && <ItemTags tags={item.tags} />}

      {/* key: item 間のソフトナビゲーションでタブ選択状態を持ち越さない */}
      <MemoPanel
        key={itemNo}
        defaultMode={memo ? "markdown" : "edit"}
        markdownView={
          <MarkdownView
            markdown={memo}
            circuits={circuits}
            allowRotate
            allowSecretEdit
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

      <ItemTimestamps item={item} />
    </div>
  );
}
