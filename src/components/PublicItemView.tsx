import type { Item } from "@/generated/prisma/client";
import { ItemTags } from "@/components/ItemTags";
import { ItemTimestamps } from "@/components/ItemTimestamps";
import { ItemUrlBox } from "@/components/ItemUrlBox";
import { LoginButton } from "@/components/LoginButton";
import { QrIcon } from "@/components/MenuIcons";
import { NoteBody } from "@/components/NoteBody";
import { MemoPanel } from "@/components/MemoPanel";
import { PendingLink } from "@/components/PendingLink";
import { ACTION_LINK_CLASS, BOX_CLASS } from "@/components/ui";
import { planCircuits } from "@/lib/circuitCache";

interface PublicItemViewProps {
  itemNo: string;
  item: Item;
}

// 公開ノートを、ログインしていない人が見る画面 (docs/22-ノート公開計画.md §4)。
//
// ここへ来た時点で isPublicItem(item) は真 (page.tsx が確かめている)。
// つまり item は必ず存在し、ゴミ箱にもない — だから ItemView と違って
// null もゴミ箱バナーも考えなくてよい。
//
// **読み取り専用**。押しても 401 や案内に化ける物は出さない (ヘッダの
// 「ログ」リンクを未ログイン時に隠しているのと同じ判断):
//   - 編集リンク・編集タブ … /edit も Server Action も閉じている
//   - 記法リンク           … 書く人のための説明。読むだけの人には要らない
//   - タグのリンク         … タグ検索は非公開なので文字だけにする
//
// QR ボタンは**出す** (docs/22 §5)。シールを見た人がその場で刷り直せる。
// /print も同じ公開判定を通してあるので、押せば実際に開く。
export async function PublicItemView({ itemNo, item }: PublicItemViewProps) {
  const memo = item.memo;
  // ```circuitikz の描画は始めるだけで待たない (ItemView と同じ理由。
  // docs/85-回路図表示待ち計画.md §3)
  const circuits = planCircuits(memo);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">
          item <span className="font-mono">#{itemNo}</span>
        </h1>
        <div className="flex gap-1">
          {/* 持ち主の画面と同じ見た目にする (docs/82 §2)。長押しの吹き出しは
              付けない — ここは押せる物が 1 つだけで、隣の文字が既に名前になっている */}
          <PendingLink
            href={`/print/${itemNo}`}
            className={ACTION_LINK_CLASS}
            transitionTypes={["nav-forward"]}
          >
            <QrIcon />
            QR
          </PendingLink>
        </div>
      </div>

      {/* 持ち主が自分のノートを未ログインのブラウザで開くことはある
          (ログアウトが無いので確認はプライベートウィンドウになる。docs/18 §3)。
          そこから編集へ入れるよう、ログインの導線だけは残す */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-green-300 bg-green-50 px-3 py-2 text-green-900">
        <p className="flex-1">
          <span aria-hidden>🌐 </span>
          <span className="font-medium">公開ノート</span> —
          閲覧のみです。編集するにはログインしてください。
        </p>
        <LoginButton />
      </div>

      {item.url && <ItemUrlBox url={item.url} />}

      <ItemTags tags={item.tags} linked={false} />

      <MemoPanel
        key={itemNo}
        // 読み取り専用なので既定は markdown で固定する。ItemView は空メモを
        // 編集タブで開くが、こちらに編集タブは無い (空メモだと何も出せない)
        defaultMode="markdown"
        // linkTags=false … 本文中の #タグ もリンクにしない。タグ検索は
        // 未ログインに閉じているので、押すと案内に化けるリンクを本文に残さない
        markdownView={
          <NoteBody memo={memo} circuits={circuits} linkTags={false} />
        }
        textView={
          <pre
            className={`whitespace-pre-wrap break-words ${BOX_CLASS} font-mono text-base`}
          >
            {memo}
          </pre>
        }
      />

      <ItemTimestamps item={item} />
    </div>
  );
}
