"use client";

import { useEffect, useState } from "react";
import { LOGIN_PATH, loginHref } from "@/lib/auth/loginRedirect";
import { LoginIcon } from "@/components/icons";
import {
  BUSY_NOTICE_CLASS,
  BUSY_SPINNER_CLASS,
  HEADER_MENU_ITEM_CLASS,
} from "@/components/ui";

interface LoginButtonProps {
  // ヘッダの中に置くか (小さい文字リンク)、案内の本文に置くか (主ボタン)
  variant?: "header" | "primary" | "menu";
  // パスキーが主になった画面 (docs/29-パスキー計画.md §8) では
  // 「パスワードでログイン」と書き分ける。ボタンが 2 つ並ぶので、
  // どちらも「ログイン」だと選べない
  label?: string;
}

// ログインボタン (docs/18-ログイン計画.md)。
//
// 素の <a> で /login へ「普通に画面遷移」させるのが要点。router.push や fetch で
// 呼ぶと、401 を受け取ってもブラウザは認証ダイアログを出さない (JS から見た
// ただの失敗レスポンスになる)。ダイアログはブラウザ自身の画面遷移でしか出ない。
//
// 戻り先はクリック時に window.location から組む。サーバ側で組めないのは、
// root layout がパスを知らないため (proxy.ts が /item/ABC を /login-required へ
// rewrite するので、サーバから見えるパスは本人の居場所と一致しない)。
// href は最初から /login で描いておき、JS が載ったら戻り先を足す —
// こうすると描き直しでずれない (hydration mismatch にならない) し、
// JS が無くてもログインだけはできる (行き先が / になるだけ)。
export function LoginButton({
  variant = "header",
  label = "ログイン",
}: LoginButtonProps) {
  // 押した後の「ログイン処理中」表示。/login への遷移 → 認証ダイアログ →
  // 初期画面が届くまでこのページは表示されたままなので、その間ずっと
  // 覆いが出続ける (認証ダイアログの背景にも見える)。無反応に見せない
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // 戻る (bfcache 復帰) でこのページが再表示されたときは覆いを畳む。
  // 出しっぱなしだと「戻ったのに処理中のまま」になる
  useEffect(() => {
    const reset = () => setIsLoggingIn(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const className =
    variant === "menu"
      ? HEADER_MENU_ITEM_CLASS
      : variant === "header"
        ? "inline-flex min-h-11 items-center rounded px-2 font-medium text-blue-600 transition-colors active:bg-blue-50"
        : "inline-flex min-h-11 items-center justify-center gap-2 rounded bg-blue-600 px-6 font-medium text-white transition-transform active:scale-95";

  return (
    <>
      <a
        href={LOGIN_PATH}
        className={className}
        onClick={(event) => {
          event.preventDefault();
          setIsLoggingIn(true);
          const here = window.location.pathname + window.location.search;
          // assign であってフレームワークの遷移ではない (上のコメント参照)
          window.location.href = loginHref(here);
        }}
      >
        {/* アイコンはメニューの行のときだけ (他の variant は文字だけの
            リンク / 主ボタンで、行頭にアイコンを置く形になっていない) */}
        {variant === "menu" && <LoginIcon />}
        {label}
      </a>
      {isLoggingIn && (
        <span
          role="status"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        >
          <span className={`${BUSY_NOTICE_CLASS} flex items-center gap-2`}>
            <span aria-hidden className={BUSY_SPINNER_CLASS} />
            ログイン処理中…
          </span>
        </span>
      )}
    </>
  );
}
