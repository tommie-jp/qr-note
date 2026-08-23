"use client";

import dynamic from "next/dynamic";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ADOPT_SERVER_EVENT,
  MEMO_BASELINE_EVENT,
  type AdoptServerDetail,
} from "@/lib/editorEvents";
import { draftStorageKey, loadDraft, persistDraft } from "@/lib/memoDraft";
import { BASE_NEW } from "@/lib/saveBase";
import type { ConflictServerNote } from "@/lib/saveState";
import { SaveFormContext } from "./NoteSaveForm";
import { SaveConflictBanner } from "./SaveConflictBanner";
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
  // この本文が載っている版 (docs/87-編集競合対策計画.md §2-2)。
  // formatBase(item?.updatedAt ?? null) をサーバ側で作って渡す。
  //
  // **本文と対でここが持つ**のが要点。フォーム側の hidden に置くと、
  // 同じ画面の markdown タブでチェックを押したときに基点だけが新しくなり、
  // 古い本文の保存が検査を素通りしてチェックを黙って戻してしまう
  base: string;
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
  base: baseProp,
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
  const [base, setBase] = useState(baseProp);
  const [isEditorReady, setIsEditorReady] = useState(false);
  // 未保存の下書きを復元したことの知らせ (黙って差し替えない)
  const [restoredDraft, setRestoredDraft] = useState(false);
  // 復元の判定が済むまで保存側を止める (先に保存が走ると、これから読む
  // 下書きを「初期値と同じ」として消しかねない)
  const draftReady = useRef(false);
  // 「このまま上書き」で送るときだけ立てる印 (消える版を先に履歴へ刻ませる)
  const [checkpoint, setCheckpoint] = useState(false);
  // 打っている最中にサーバ側の本文が動いた (保持したまま保存時に確かめる)
  const [serverMoved, setServerMoved] = useState(false);
  // 既に見せた競合の印。同じ結果に 2 度反応しない
  const [dismissedSeq, setDismissedSeq] = useState<number | null>(null);
  // 本文を外から差し替えたら CodeMirror を作り直す番号。
  // **undo 履歴を切るため**で、差し替えを 1 手として履歴に残すと
  // 「元に戻す」で古い本文 + 新しい基点の対ができ、検査を素通りしてしまう
  const [editorKey, setEditorKey] = useState(0);
  // 最後にサーバと揃えた (本文, 基点) の対。追随の判断に使う
  const syncedRef = useRef({ text: initialValue, base: baseProp });
  // フォームを辿るための目印 (UnsavedGuard と同じやり方)
  const markerRef = useRef<HTMLSpanElement>(null);
  const saveState = useContext(SaveFormContext);
  const conflict =
    saveState !== null && saveState.seq !== dismissedSeq ? saveState : null;

  const formOf = () => markerRef.current?.closest("form") ?? null;

  // 本文をサーバ値へ揃え直したことを、同じフォームの中へ知らせる
  // (UnsavedGuard が比較の基準を取り直す)
  const notifyBaseline = () => {
    formOf()?.dispatchEvent(new CustomEvent(MEMO_BASELINE_EVENT));
  };

  // サーバ再描画で (本文, 基点) が動いたときの追随 (docs/87 §2-3)。
  //
  //   打っていない        → 本文・基点とも黙って追随 (失うものが無い)
  //   もう同じ            → 基点だけ追随 (保存直後など)
  //   打っている最中      → どちらも保持 → 保存で競合になり、選ばせる
  //
  // value を依存に入れているのは「動いた瞬間の本文」を見るため。打鍵のたびに
  // 走るが、対が揃っていれば即 return する
  useEffect(() => {
    const synced = syncedRef.current;
    if (synced.text === initialValue && synced.base === baseProp) {
      return;
    }
    const pristine = value === synced.text;
    const sameAsIncoming = value === initialValue;
    syncedRef.current = { text: initialValue, base: baseProp };

    /* eslint-disable react-hooks/set-state-in-effect */
    if (!pristine && !sameAsIncoming) {
      setServerMoved(true);
      return;
    }
    setBase(baseProp);
    if (!sameAsIncoming) {
      setValue(initialValue);
      setEditorKey((key) => key + 1);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    notifyBaseline();
    // notifyBaseline は描画に依らない (DOM を辿るだけ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue, baseProp, value]);

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
          setValue(restored.value);
          // **本文と対で基点も戻す** (docs/87 §2-6)。いまの版を当てると、
          // タブが落ちている間に別の端末が保存した分を黙って潰せてしまう。
          // 基点を持たない古い下書きは stale = 必ず競合になる
          setBase(restored.base);
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
        // 比較の基準は「最後にサーバと揃えた本文」。揃え直した本文に
        // 戻ったら下書きは要らない
        persistDraft(
          window.localStorage,
          draftKey,
          value,
          syncedRef.current.text,
          base,
          Date.now(),
        );
      } catch {
        // 書けない環境 (容量・プライベートモード) では諦める
      }
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftKey, value, base, initialValue]);

  // 別の版を本文として読み込む (自分の変更は捨てる)。
  // 基点も一緒に差し替え、CodeMirror は作り直して undo 履歴を切る
  const adoptServer = (server: ConflictServerNote) => {
    const nextBase = String(server.updatedAt);
    setValue(server.memo);
    setBase(nextBase);
    setEditorKey((key) => key + 1);
    setServerMoved(false);
    syncedRef.current = { text: server.memo, base: nextBase };
    // /edit の url / mode も揃える (この画面には無いこともある)
    formOf()?.dispatchEvent(
      new CustomEvent<AdoptServerDetail>(ADOPT_SERVER_EVENT, {
        detail: { url: server.url, mode: server.mode },
      }),
    );
    notifyBaseline();
  };

  // いま見せた版の上に自分の本文を載せて送り直す。
  //
  // hidden は state 制御なので flushSync で DOM へ反映してから送る
  // (同期に requestSubmit すると古い基点のまま送られる)。checkpoint は
  // 一発もの — 残すと次の普通の保存が自分の直前版を conflict として刻む
  const resubmit = (nextBase: string, withCheckpoint: boolean) => {
    const form = formOf();
    if (!form) {
      return;
    }
    flushSync(() => {
      setBase(nextBase);
      setCheckpoint(withCheckpoint);
    });
    form.requestSubmit();
    setCheckpoint(false);
  };

  // 復元した下書きを捨てて、保存済みの本文に戻す
  const discardDraft = () => {
    setValue(initialValue);
    setEditorKey((key) => key + 1);
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
      <span ref={markerRef} hidden />
      <input type="hidden" name="memo" value={value} />
      <input type="hidden" name="base" value={base} />
      {checkpoint && <input type="hidden" name="checkpoint" value="1" />}
      {conflict && (
        <SaveConflictBanner
          state={conflict}
          value={value}
          onAdoptServer={() => {
            if (conflict.server) {
              adoptServer(conflict.server);
            }
            setDismissedSeq(conflict.seq);
          }}
          onOverwrite={() => {
            setDismissedSeq(conflict.seq);
            resubmit(
              conflict.server === null ? BASE_NEW : String(conflict.server.updatedAt),
              true,
            );
          }}
          onSaveAsNew={() => {
            setDismissedSeq(conflict.seq);
            resubmit(BASE_NEW, false);
          }}
          onDismiss={() => setDismissedSeq(conflict.seq)}
        />
      )}
      {serverMoved && !conflict && (
        <p aria-live="polite" className="text-sm text-gray-500">
          別の操作で本文が変わりました (保存するときに確かめます)
        </p>
      )}
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
        key={editorKey}
        value={value}
        onChange={setValue}
        onReady={() => setIsEditorReady(true)}
        autoFocus={autoFocus}
        minHeight={minHeight}
      />
    </div>
  );
}
