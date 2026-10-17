import Link from "next/link";
import type { Item } from "@/generated/prisma/client";
import {
  assignNoteNumberAction,
  recordHealthAction,
  restoreItemsAction,
  setItemOfflinePinAction,
  setItemPublicAction,
  toggleMemoTaskAction,
  updateMemoAction,
} from "@/app/actions";
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
import { TrashedBanner } from "@/components/trash/TrashedBanner";
import { UnsavedGuard } from "@/components/editor/UnsavedGuard";
import { ACTION_LINK_CLASS, BOX_CLASS } from "@/components/ui";
import { isDemoMode } from "@/lib/appEnv";
import { hasNoteNumber } from "@/lib/items/noteNumber";
import { planCircuits } from "@/lib/circuit/cache";
import { buildHealthCharts } from "@/lib/health/healthData";
import { buildMatrices } from "@/lib/matrix/matrixData";
import { pinAttachmentBytes } from "@/lib/offline/pinSize";
import { formatBase } from "@/lib/editor/saveBase";
import { allImageNames } from "@/lib/images/memoImages";
import { SavedDraftCleanup } from "@/components/editor/SavedDraftCleanup";

interface ItemViewProps {
  itemId: string;
  item: Item | null;
  // 更新直後だけ付く保存時刻。トーストを出す印 (docs/11 §2-3)
  saved?: string;
}

// 持ち主 (ログイン中) が見る /item の画面。
//
// ログインしていない人が見るのは PublicItemView のほう (docs/22-ノート公開計画.md §4)。
// 分岐は page.tsx が持ち、ここは「ログイン済み」だけを考える。
//
// Ver1 と同じく未登録の itemId でも開けて、その場で memo を書いて新規作成できる
// (QR シールを先に貼っておける)。
export async function ItemView({ itemId, item, saved }: ItemViewProps) {
  const memo = item?.memo ?? "";
  // ```circuitikz は TeX (WASM) で描くため非同期。**ここでは待たない**
  // (docs/85-回路図表示待ち計画.md §3)。始めるだけ始めて約束を渡し、
  // 描き上がるまでの「準備中」は図の場所だけに出す (CircuitDiagram)。
  //
  // await すると初回表示 (DB キャッシュミス) で 1 枚 1〜3 秒、見出しも
  // 問題文も 1 文字も出せないまま止まる — 本番は 3 コア・空き 750MB で、
  // 描画のピーク 400MB がそのままページの待ち時間になる
  const circuits = planCircuits(memo);

  // 印を付けたときに落ちる量も一緒に数える。どれも memo だけから決まる
  // 独立な問い合わせなので並べる (直列にすると待つ分だけ遅くなる)
  const [attachmentBytes, matrices, health] = await Promise.all([
    pinAttachmentBytes(memo),
    // ```matrix の集計。**ここ (ログイン済みの画面) からしか渡さない** —
    // 公開ビューは回路図のために planCircuits を呼んでいるので、
    // 並べて置くと非公開ノートの一覧が匿名の閲覧者に漏れる (docs/77 §6)
    buildMatrices(memo),
    // ```health の集計も同じ (docs/83 §8)。こちらは体重・体温が並ぶので、
    // 漏れたときの取り返しは学習状況よりつかない
    buildHealthCharts(memo),
  ]);

  // 区切りを書いていないノートにはページの切り替えを出さない (押しても
  // 見た目が変わらないボタンになる)。**ここで数えるのが素直** — 本文を
  // 描く NoteBody は本文パネルの奥に居て、ページ数を見出し行へ返す道が無い。
  // 区切りになりうる行が無ければ remark を通さない近道があるので
  // (components/notepage/notePages.ts)、大多数のノートでは行を舐めるだけで済む
  const hasPages = splitPages(memo).length > 1;
  // 画像の表示モード (docs/106) も、画像の無いノートには出さない (同じ理由)
  const hasImages = allImageNames(memo).length > 0;

  // ノートの操作は MemoPanel が畳むか積むかを決める (docs/108-ノート全画面表示計画.md)。
  // 積むときの並びは 見出し行 → 通知の束 → タグ → タブ → 時刻 で、これまでと同じ。
  // 畳むときは通知の束だけを本文の上に残す (警告と QR の飛び先は隠さない)
  //
  // 見出し行の flex-wrap … テキストサイズ (docs/61) を上げると見出しと操作リンク
  // (編集 / 履歴 / QR / 記法) が 1 行に収まらない。折り返さないと画面ごと
  // 横スクロールになるので、2 行になるほうを取る (ヘッダーの帯と同じ判断)。
  // items-center … 枠付きのトグルは baseline で揃えると沈む
  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">
          item
        </h1>
        {/* 未登録のノートにはトグルを出さない。まだ公開する中身がない
            (docs/22 §7)。デモモードでは公開機能を封じるのでトグル自体を
            出さない (docs/38-デモモード計画.md §3。Server Action 側でも
            塞いでいる)。オフラインの印も同じ判断 — デモは同期の口ごと
            閉じてある (api/sync/items) ので、押せても何も起きない */}
        {item && !isDemoMode() && (
          <>
            <PublicToggle
              itemId={itemId}
              publicAt={item.publicAt}
              setPublicAction={setItemPublicAction}
            />
            <OfflinePinToggle
              itemId={itemId}
              pinned={item.offlinePin}
              attachmentBytes={attachmentBytes}
              setPinAction={setItemOfflinePinAction}
            />
          </>
        )}
      </div>
      {/* 操作リンクは色付きのアイコン + 文字 (docs/82-ノート操作アイコン計画.md §2)。
          並んだ 4〜5 個を**絵の形より先に色で拾い分ける**ための色なので、
          行の中で色が重ならないことがこの一群の要件になる。
          長押しの吹き出し (PressTip) には、文字より少し詳しい説明を入れる —
          見えているラベルをなぞるだけの tooltip は読む値打ちがない */}
      <div className="flex flex-wrap gap-1">
        <PressTip label="このノートを編集する">
          <Link
            href={`/edit/${itemId}`}
            className={ACTION_LINK_CLASS}
            transitionTypes={["nav-forward"]}
          >
            <EditIcon />
            編集
          </Link>
        </PressTip>
        {/* git 履歴 (docs/57-ノートgit履歴計画.md)。デモでは機能ごと閉じる
            のでリンクも出さない (PublicToggle と同じ判断) */}
        {!isDemoMode() && (
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
        {/* 番号を振る (docs/111 §6)。QR の左 — 振ると QR が短くなる、の順に並べる。
            番号の無いノートだけ。未登録のノートには振る本文が無く、デモは
            種 DB が毎時戻るので出さない (アクション側でも断る) */}
        {item && !hasNoteNumber(item.tags) && !isDemoMode() && (
          <NumberAssignButton itemId={itemId} assignAction={assignNoteNumberAction} />
        )}
        {/* /print は loading.tsx を持たない force-dynamic なページなので、
            押してから画面が変わるまでの間はリンク側でスピナーを出す */}
        <PressTip label="QR シールを印刷する">
          <PendingLink
            href={`/print/${itemId}`}
            className={ACTION_LINK_CLASS}
            transitionTypes={["nav-forward"]}
          >
            <QrIcon />
            QR
          </PendingLink>
        </PressTip>
        {/* ページの切り替えは QR の右 (docs/82 §3)。区切りのあるノートだけ */}
        {hasPages && <NotePageModeToggle />}
        {/* 画像の表示モードはページの右 (docs/106)。どちらも本文の読み方 */}
        {hasImages && <ImageFitToggle />}
        <PressTip label="メモ記法の書き方を見る">
          <Link
            href="/docs/memo"
            className={ACTION_LINK_CLASS}
            transitionTypes={["nav-forward"]}
          >
            <NotationIcon />
            記法
          </Link>
        </PressTip>
        {/* 操作を畳むか常に出すか (docs/108)。この行そのものの出し方なので末尾 */}
        <NoteChromePinToggle />
      </div>
    </div>
  );

  // 出たときだけ間隔を持つ通知の束。1 つも出なければ empty:hidden で
  // 箱ごと消え、余白も残らない。
  // **&& ではなく三項で null を返す** — 条件が null や空文字のとき && は
  // その値を返し、空のテキストノードで :empty が外れて余白だけが残る
  const notices = (
    <div className="space-y-3 py-3 empty:hidden">
      {!item ? (
        <p className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
          未登録の部品番号です。メモを保存すると新規登録されます。
        </p>
      ) : null}
      {item?.deletedAt ? (
        <TrashedBanner itemId={itemId} restoreAction={restoreItemsAction} />
      ) : null}
    </div>
  );

  const tags = item ? <ItemTags tags={item.tags} /> : null;
  // ItemTimestamps 自体は /edit と公開ビューでも使われるので、余白は
  // 置く側 (MemoPanel) が持つ
  const footer = <ItemTimestamps item={item} />;
  // 畳んでいる間も公開中だけは見えるようにする (docs/108 §2)。気づかずに
  // 公開したままにしないため。押す物ではなく印
  const badge = item?.publicAt ? (
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
      {/* 画面下部に浮くトーストなので、下の「通知の束」には入れない。
          入れると fixed で場所を取らないのに束が空でなくなり、消えるまでの
          2 秒だけ余白が開いて、消えた瞬間に本文が跳ね上がる */}
      {saved && <SavedToast key={saved} />}
      {saved && <SavedDraftCleanup draftKey={itemId} />}

      {/* key: item 間のソフトナビゲーションでタブ選択状態を持ち越さない */}
      <MemoPanel
        key={itemId}
        chrome={{ heading, notices, tags, footer, badge }}
        defaultMode={memo ? "markdown" : "edit"}
        markdownView={
          <ImageFitScope>
            <NoteBody
              memo={memo}
              circuits={circuits}
              matrices={matrices}
              health={health}
              allowRotate
              allowSecretEdit
              onToggleTask={toggleMemoTaskAction.bind(null, itemId)}
              onRecordHealth={recordHealthAction.bind(null, itemId)}
            />
          </ImageFitScope>
        }
        textView={
          <pre
            className={`whitespace-pre-wrap break-words ${BOX_CLASS} font-mono text-base`}
          >
            {memo}
          </pre>
        }
        editForm={
          <NoteSaveForm
            action={updateMemoAction}
            itemId={itemId}
            className="space-y-3"
          >
            <UnsavedGuard />
            <MemoEditor
              defaultValue={memo}
              // 開いた時点の版。競合したらバナーで差分を見て選べる
              // (docs/87-編集競合対策計画.md)
              base={formatBase(item?.updatedAt ?? null)}
              minHeight="18rem"
              autoFocus={memo === ""}
              // 下書きにも基点が乗るようになったので、この画面でも安全に残せる
              draftKey={itemId}
            />
            {/* 「更新」は画面下部の操作バーへ移した (MemoEditorInner が portal で
                差し込む)。この form の子孫のまま送信される */}
          </NoteSaveForm>
        }
      />
    </div>
  );
}
