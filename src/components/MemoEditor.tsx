"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { draftStorageKey, loadDraft, persistDraft } from "@/lib/memoDraft";
import {
  BUSY_NOTICE_CLASS,
  BUSY_SPINNER_CLASS,
  MEMO_INPUT_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "./ui";
import {
  type PrefillKind,
  type PrefillStatus,
  type PrefillTarget,
  usePrefill,
} from "./usePrefill";

// CodeMirror 一式は重いので、エディタが実際に表示されるまで読み込まない
const MemoEditorInner = dynamic(() => import("./MemoEditorInner"), {
  ssr: false,
  loading: () => null,
});

// 取得は数秒かかることがあり (実機で確認)、無表示だと
// 「取得に失敗した」と見分けられない。取得中と結果をここで知らせる
// (docs/13-書誌自動取得計画.md §4)。
// 文言は種別で変える。JAN の取得中に「書籍情報」と出すと本を探しているように読める
const PREFILL_NOUN: Record<PrefillKind, string> = {
  book: "書籍情報",
  product: "商品情報",
};

// デモインスタンスの取得無効メッセージ (docs/39-デモ公開計画.md §5)。
// product は取得中などの noun (「商品情報」) と違い「JAN 情報」と呼ぶ —
// デモでは外部キーが無く、そもそも JAN で引けないことを直接伝えるため。
//
// **book はデモでも取れるようになった** (docs/45-デモ書誌開放計画.md) ので、
// サーバは書籍で demoDisabled を返さず、この book の文言は通常は出ない。
// 将来デモで書誌を再び閉じたときに正しい文言が出るよう、防御的に残す。
const PREFILL_DEMO_MESSAGE: Record<PrefillKind, string> = {
  book: "デモ版では書籍情報を取得できません",
  product: "デモ版では JAN 情報を取得できません",
};

function prefillMessage(kind: PrefillKind, status: PrefillStatus): string {
  const noun = PREFILL_NOUN[kind];
  const messages: Record<PrefillStatus, string> = {
    idle: "",
    loading: `${noun}を取得中…`,
    // 成功したときは書名・商品名が本文に出るので、文言では言わない
    loaded: "",
    skipped: `${noun}を取得しましたが、編集中のため反映していません`,
    notFound: `${noun}が見つかりませんでした`,
    error: `${noun}の取得に失敗しました`,
    demoDisabled: PREFILL_DEMO_MESSAGE[kind],
  };
  return messages[status];
}

// 取得の状況。min-h で 1 行ぶんの高さを確保し、文言が消えるときに
// エディタが動かないようにする (打っている最中に入力欄がずれない)。
// 取得中 (= 時間のかかる準備) だけは赤背景バナーで目立たせる。取得は
// ページを開いた直後に走るので、解消時の高さ変化が打鍵とぶつかることはない
function PrefillNotice({ kind, status }: { kind: PrefillKind; status: PrefillStatus }) {
  const message = prefillMessage(kind, status);
  const isLoading = status === "loading";
  return (
    <p
      // 後から届く知らせなので、読み上げにも伝える
      aria-live="polite"
      aria-busy={isLoading}
      className={
        isLoading
          ? `${BUSY_NOTICE_CLASS} flex items-center gap-2`
          : `flex min-h-6 items-center gap-2 ${
              status === "error" ? "text-red-700" : "text-gray-500"
            }`
      }
    >
      {isLoading && <span aria-hidden className={BUSY_SPINNER_CLASS} />}
      {message}
    </p>
  );
}

interface MemoEditorProps {
  defaultValue: string;
  autoFocus?: boolean;
  minHeight?: string;
  // 新規登録するコードが ISBN / JAN のときだけ渡す。書誌・商品情報を引いて
  // defaultValue を差し替える (docs/13-書誌自動取得計画.md / docs/14)
  prefill?: PrefillTarget;
  // 渡すと編集中の本文を localStorage に退避する (ノートごとに一意な鍵。
  // 通常は itemNo)。タブが落ちても再訪時に復元できる (src/lib/memoDraft.ts)。
  // iPhone は OCR のモデル読み込みでタブごと再起動することがあり、その保険
  draftKey?: string;
}

// 下書きの保存は打鍵のたびではなく少し待ってから (連打で localStorage を叩かない)
const DRAFT_SAVE_DELAY_MS = 400;

// markdown 用 memo エディタ。フォーム送信値は常にここの hidden input が持つため、
// CodeMirror の読み込み完了前に「更新」を押しても現在値がそのまま送信される
// (読み込み中に memo フィールドが欠けてデータが消えることはない)
export function MemoEditor({
  defaultValue,
  autoFocus = false,
  minHeight = "14rem",
  prefill,
  draftKey,
}: MemoEditorProps) {
  // 行末を LF に揃えてから渡す。DB には Ver1 由来の CRLF の本文があり、
  // CodeMirror は行末を LF として扱うので、素のまま渡すと「エディタの中身」と
  // この hidden input が初手から食い違う。すると @uiw/react-codemirror が
  // 差を埋めようと dispatch し、履歴に見えない 1 手が積まれてしまう
  // (何も編集していないのに「元に戻す」が押せ、押すと本文が dirty になる)。
  // どのみち 1 文字でも打てば LF に正規化されて保存されるので、最初から揃える
  const initialValue = useMemo(() => defaultValue.replace(/\r\n/g, "\n"), [defaultValue]);
  const [value, setValue] = useState(initialValue);
  const [isEditorReady, setIsEditorReady] = useState(false);
  // 未保存の下書きを復元したことの知らせ (黙って差し替えない)
  const [restoredDraft, setRestoredDraft] = useState(false);
  // 復元の判定が済むまで保存側を止める (先に保存が走ると、これから読む
  // 下書きを「初期値と同じ」として消しかねない)
  const draftReady = useRef(false);

  // マウント時に一度だけ、未保存の下書きがあれば復元する。
  // localStorage が使えない環境 (プライベートモード等) では下書き保護なしで
  // 通常動作に落ちる (下書きは保険であって本筋ではない)
  useEffect(() => {
    if (draftKey) {
      try {
        const restored = loadDraft(window.localStorage, draftKey, initialValue);
        if (restored !== null) {
          // useState の初期化で読むと SSR の出力とずれて hydration が壊れる。
          // 「hydration 後に localStorage と一度だけ同期する」ためのマウント時
          // effect であり、連鎖レンダリングは起きない (依存なしで再実行されない)
          /* eslint-disable react-hooks/set-state-in-effect */
          setValue(restored);
          setRestoredDraft(true);
          /* eslint-enable react-hooks/set-state-in-effect */
        }
      } catch {
        // 読めない環境では何もしない
      }
    }
    draftReady.current = true;
    // 初回だけ。draftKey / initialValue はページ遷移で作り直される
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 編集のたびに下書きを退避する (少し待ってから)。初期値に戻れば消す
  useEffect(() => {
    if (!draftKey || !draftReady.current) {
      return;
    }
    const timer = setTimeout(() => {
      try {
        persistDraft(window.localStorage, draftKey, value, initialValue, Date.now());
      } catch {
        // 書けない環境 (容量・プライベートモード) では諦める
      }
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftKey, value, initialValue]);

  // 復元した下書きを捨てて、保存済みの本文に戻す
  const discardDraft = () => {
    setValue(initialValue);
    setRestoredDraft(false);
    if (draftKey) {
      try {
        window.localStorage.removeItem(draftStorageKey(draftKey));
      } catch {
        // 消せなくても実害はない (次の編集で上書きされる)
      }
    }
  };

  // 書誌・商品情報が届いたら本文を差し替える (まだ何も打っていなければ)。
  // 差し替えは CodeMirror の履歴に 1 手として積まれるので、要らなければ
  // 「元に戻す」で事前入力だけの状態に戻せる
  const prefillStatus = usePrefill({
    target: prefill,
    value,
    pristine: initialValue,
    setMemo: setValue,
  });

  return (
    <div className="space-y-2">
      <input type="hidden" name="memo" value={value} />
      {/* エディタの上に置く。スキャン直後に目が行くのは本文の先頭で、
          下に置くと見落とす */}
      {prefill && <PrefillNotice kind={prefill.kind} status={prefillStatus} />}
      {restoredDraft && (
        <p
          aria-live="polite"
          className="flex flex-wrap items-center gap-2 rounded bg-amber-50 px-3 py-2 text-amber-800"
        >
          保存前の下書きを復元しました。「更新」を押すまで保存はされていません。
          <button
            type="button"
            onClick={discardDraft}
            className={SECONDARY_BUTTON_CLASS}
          >
            下書きを破棄
          </button>
        </p>
      )}
      {!isEditorReady && (
        <textarea
          readOnly
          rows={8}
          value={value}
          className={MEMO_INPUT_CLASS}
          placeholder="エディタを読み込み中…"
        />
      )}
      <MemoEditorInner
        value={value}
        onChange={setValue}
        onReady={() => setIsEditorReady(true)}
        autoFocus={autoFocus}
        minHeight={minHeight}
      />
    </div>
  );
}
