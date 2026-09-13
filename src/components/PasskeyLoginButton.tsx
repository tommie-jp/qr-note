"use client";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useEffect, useRef, useState } from "react";
import { errorText } from "@/lib/errorMessage";
import { loginWithPasskey, PasskeyCancelledError } from "@/lib/passkeyClient";
import {
  hasPasskeyHint,
  isAutoLoginSuppressed,
  suppressAutoLogin,
} from "@/lib/passkeyHint";
import { KeyIcon } from "@/components/icons";
import {
  HEADER_MENU_ITEM_CLASS,
  PRIMARY_BUTTON_CLASS,
} from "@/components/ui";

interface PasskeyLoginButtonProps {
  // ヘッダの中に置くか (小さい文字リンク)、案内の本文に置くか (主ボタン)、
  // ハンバーガーメニューの 1 行として置くか
  variant?: "header" | "primary" | "menu";
  // このブラウザにパスキーの実績があれば、押さなくてもログインを試みる
  // (docs/29-パスキー計画.md §13)。渡してよいのは「ログインが必要です」の
  // 案内だけ —— ヘッダは公開ノートにも出るため、そこで自動発火させると
  // 共有リンクを開いただけの人に Face ID ダイアログが出る
  autoStart?: boolean;
}

// パスキーでログインするボタン (docs/29-パスキー計画.md §8, §13)。
//
// LoginButton (Basic 認証) と対になる。あちらは「素の <a> で画面遷移する」
// ことが要点だったが、こちらは逆に **JS から呼ばなければ始まらない** —
// navigator.credentials.get() はブラウザの API であって、URL を開いて
// 出せるものではない。だからこれはクライアントコンポーネント。
//
// 成功したらページを丸ごと読み込み直す (router.refresh ではなく
// location.reload)。Cookie が付いた状態でサーバから描き直す必要があり、
// しかも今いる画面は proxy.ts に /login-required へ rewrite された結果
// かもしれない — その場合 refresh では中身が戻らない。
export function PasskeyLoginButton({
  variant = "header",
  autoStart = false,
}: PasskeyLoginButtonProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // 自動発火は 1 マウントにつき 1 回だけ。React の StrictMode は開発時に
  // effect を 2 回走らせるため、これが無いとダイアログが二重に出る
  const autoStartedRef = useRef(false);

  const className =
    variant === "menu"
      ? `${HEADER_MENU_ITEM_CLASS} disabled:opacity-60`
      : variant === "header"
        ? "inline-flex min-h-11 items-center rounded px-2 font-medium text-blue-600 transition-colors active:bg-blue-50 disabled:opacity-60"
        : PRIMARY_BUTTON_CLASS;

  async function startLogin({ isAuto }: { isAuto: boolean }) {
    setError(null);
    setIsBusy(true);
    try {
      await loginWithPasskey();
      window.location.reload();
      // reload は即座には効かないので、ここで止めて二度押しを防ぐ
      return;
    } catch (cause) {
      if (cause instanceof PasskeyCancelledError) {
        // 自分でやめた操作。黙って元に戻す (赤い字で叱らない)。
        //
        // 自動発火を断ったときは、このタブでは以後出さない。保護ページを
        // 開くたびに勝手にダイアログが出るのは不快なため。iOS がジェスチャ
        // 無しの呼び出しを即 NotAllowedError で断る場合もここへ来るので、
        // その環境では自動発火が黙って「強調のみ」に退化する
        if (isAuto) {
          suppressAutoLogin();
        }
        setIsBusy(false);
        return;
      }
      // 自動発火の失敗は赤字にしない (docs/29-パスキー計画.md §13)。
      //
      // 利用者はページを開いただけで、何も頼んでいない。そこへ赤いエラーを
      // 出すと「壊れた」ように見える。実際 パスキーを全部消した状態で
      // 「まだ登録されていません」が出てしまい、案内としても的外れだった。
      // 黙って通常の案内 (ボタン 2 つ) に戻し、押されたときに本当の理由を出す。
      // 原因は握りつぶさず console に残す
      if (isAuto) {
        console.error("パスキーの自動ログインに失敗しました", cause);
        setIsBusy(false);
        return;
      }
      setError(errorText(cause, "ログインできませんでした"));
      setIsBusy(false);
    }
  }

  // 初期描画は props だけで決まる (ヒントは見ない)。storage を読むのは
  // ここ = マウント後だけにして、サーバの HTML とずれないようにする
  useEffect(() => {
    if (!autoStart || !hasPasskeyHint()) {
      return;
    }

    // 実績があるなら、自動発火できてもできなくてもボタンに寄せておく。
    // 自動が動かない環境 (iOS のジェスチャ要件など) でも Enter 一発で入れる
    buttonRef.current?.focus();

    if (isAutoLoginSuppressed() || !browserSupportsWebAuthn()) {
      return;
    }
    if (autoStartedRef.current) {
      return;
    }
    autoStartedRef.current = true;

    void startLogin({ isAuto: true });
  }, [autoStart]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          // メニューの中に居るとき、親のバブリングで閉じられないようにする。
          // 閉じるとこの部品ごと unmount され、失敗しても赤字を出す先が
          // 消えてしまう (成功時は reload なので閉じても困らないが、
          // 失敗が黙って消えるのは困る)
          event.stopPropagation();
          void startLogin({ isAuto: false });
        }}
        disabled={isBusy}
        className={className}
      >
        {/* アイコンはメニューの行のときだけ (他の variant は文字だけの
            リンク / 主ボタンで、行頭にアイコンを置く形になっていない) */}
        {variant === "menu" && <KeyIcon />}
        {/* 共有のスピナー (BUSY_SPINNER_CLASS) は赤背景用の白なので、
            白地のここでは見えない。文字で状態を出す */}
        {isBusy ? "ログイン中…" : "パスキーでログイン"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </>
  );
}
