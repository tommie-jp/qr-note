import Link from "next/link";
import { notFound } from "next/navigation";
import {
  recordAccessAction,
  restoreItemsAction,
  updateItemAction,
} from "@/app/actions";
import { AttributionFooter } from "@/components/AttributionFooter";
import { EditItemFields } from "@/components/EditItemFields";
import { ItemTimestamps } from "@/components/ItemTimestamps";
import { MemoEditor } from "@/components/MemoEditor";
import { NoteSaveForm } from "@/components/NoteSaveForm";
import { PageTransition } from "@/components/PageTransition";
import { RecordAccess } from "@/components/RecordAccess";
import { TrashedBanner } from "@/components/TrashedBanner";
import { UnsavedGuard } from "@/components/UnsavedGuard";
import { ACTION_LINK_CLASS } from "@/components/ui";
import { getItem } from "@/lib/items";
import { formatBase } from "@/lib/saveBase";
import { isIsbn, isJan, isTaggableCode, scanRegisterMemo } from "@/lib/scanRegister";
import { isValidItemNo } from "@/lib/validation";

export const dynamic = "force-dynamic";

interface EditPageProps {
  params: Promise<{ itemNo: string }>;
  searchParams: Promise<{ code?: string }>;
}

// Ver1 の /edit/:itemNo 相当。mode / memo / url をまとめて編集する
export default async function EditPage({ params, searchParams }: EditPageProps) {
  const { itemNo } = await params;
  if (!isValidItemNo(itemNo)) {
    notFound();
  }
  const [item, { code }] = await Promise.all([getItem(itemNo), searchParams]);
  const mode = item?.mode ?? "memo";

  // スキャンした未登録コードからの新規登録 (docs/10-スキャン新規登録計画.md §5)。
  // 既存ノートには効かせない。採番が競合して先に使われていた場合、既存の本文を
  // 黙って上書きする初期値を出すと、そのまま更新して壊しかねない。
  // タグにできない code は無視する (通常の導線では来ない。URL を手で触った場合)
  const newCode = !item && code && isTaggableCode(code) ? code : null;
  const defaultMemo = newCode ? scanRegisterMemo(newCode) : (item?.memo ?? "");
  // ISBN なら書誌 (docs/13-書誌自動取得計画.md)、JAN なら商品情報
  // (docs/14-JAN商品情報取得計画.md) の自動取得を任せる。取得はクライアントが
  // 後から引くので、ここでは待たない
  const prefill = !newCode
    ? undefined
    : isIsbn(newCode)
      ? ({ kind: "book", code: newCode } as const)
      : isJan(newCode)
        ? ({ kind: "product", code: newCode } as const)
        : undefined;

  return (
    <PageTransition>
      {/* 編集画面を開いたのも「触った」に数える (docs/37-アクセス順計画.md)。
          この画面は proxy.ts が未ログインを止める口なので、公開ノートの
          読み手が並びを動かす心配はない */}
      <RecordAccess itemNo={itemNo} action={recordAccessAction} />
      <div className="space-y-4">
        <h1 className="text-xl font-bold">
          edit <span className="font-mono">#{itemNo}</span>
        </h1>

        {/* 保存しても deletedAt は触らない (復元は明示的な操作だけ) ので、
            ここで知らせないと「編集して更新したのに検索に出ない」になる
            (docs/12-ゴミ箱計画.md §5) */}
        {item?.deletedAt && (
          <TrashedBanner itemNo={itemNo} restoreAction={restoreItemsAction} />
        )}

        {/* 保存は「開いたときの版のままなら書く」(docs/87-編集競合対策計画.md)。
            競合したら画面を作り直さずにバナーだけ出すので、フォームは
            useActionState で戻り値を受ける包み (NoteSaveForm) にする */}
        <NoteSaveForm
          action={updateItemAction}
          itemNo={itemNo}
          className="space-y-3"
        >
          <UnsavedGuard />
          {/* mode / url は制御コンポーネント。React 19 は送信のたびに
              フォームのリセットを予約するので、非制御のままだと競合の
              知らせが返った瞬間に打ち込みが巻き戻る */}
          <EditItemFields defaultUrl={item?.url ?? ""} defaultMode={mode}>
            <MemoEditor
              defaultValue={defaultMemo}
              // 本文と対で凍結する版 (未登録なら "new" = これから作る)
              base={formatBase(item?.updatedAt ?? null)}
              autoFocus
              prefill={prefill}
              draftKey={itemNo}
            />
          </EditItemFields>
          {/* 「更新」は画面下部の操作バーへ移した (MemoEditorInner が portal で
              差し込む)。この form の子孫のまま送信されるので mode/url も一緒に届く */}
        </NoteSaveForm>

        <ItemTimestamps item={item} />

        <div className="flex gap-1">
          <Link
            href={`/item/${itemNo}`}
            className={ACTION_LINK_CLASS}
            transitionTypes={["nav-back"]}
          >
            表示へ
          </Link>
          <Link href="/" className={ACTION_LINK_CLASS} transitionTypes={["nav-back"]}>
            一覧へ
          </Link>
        </div>

        {/* 使っている Web サービスの帰属フッター (docs/47・docs/48)。
            JAN 商品情報 (Yahoo!ショッピング API) の結果が実際に現れるのは
            この編集画面の事前入力だけなので、「API を使う画面の下部」を
            ここで満たす。Yahoo の規定クレジット (義務) に加え、出典として
            楽天・openBD・国会への導線も並べる。form の外に置くので sticky の
            「更新」とは重ならない。JAN 由来かで出し分けず無条件 (デモでも) */}
        <AttributionFooter />
      </div>
    </PageTransition>
  );
}
