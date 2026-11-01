"use client";

import { useState } from "react";
import { LOGOUT_PATH } from "@/lib/auth/paths";
import { LogoutIcon } from "@/components/icons";
import { HEADER_MENU_ITEM_CLASS } from "@/components/ui";
import { clearOfflineData } from "@/lib/offline/snapshotDb";
import { clearMemoDrafts } from "@/lib/prefs/memoDraft";

// ログアウト (docs/18-ログイン計画.md §11)。
//
// ログイン手段 (パスワード / パスキー) によらず必ずセッションを持つので、
// ログイン中なら常に出してよい。かつては「パスワードで入っているときは
// ログアウトできない」という制約があったが、資格情報を検証する場所を
// /login だけに絞ったことで消えた。
//
// **ただし完全なログアウトではない**。ブラウザは Basic 認証の資格情報を
// 記憶したままなので、同じ端末で「パスワードでログイン」を押せば
// パスワード入力なしで入り直せる。これは Basic 認証をブラウザに預ける
// 方式の限界で、断ち切るにはブラウザを閉じるしかない。
//
// 成功したら location.reload で描き直す。Cookie が消えた状態のヘッダ
// (ログインボタンが出る形) をサーバから貰い直す必要がある。
export function LogoutButton({
  variant = "header",
}: {
  variant?: "header" | "menu";
}) {
  const [isBusy, setIsBusy] = useState(false);

  async function handleClick() {
    setIsBusy(true);
    try {
      const response = await fetch(LOGOUT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`ログアウトに失敗しました (${response.status})`);
      }
      window.location.reload();
    } catch (error) {
      // 握りつぶさない。「押したのに入ったまま」の原因を追えるようにする
      console.error("ログアウトに失敗しました", error);
      setIsBusy(false);
    } finally {
      // 端末に持ち出したノート・添付・未保存の下書きを消す (docs/65-オフライン対応計画.md)。
      //
      // **セッションを切るだけでは足りない。** /offline はログイン不要で
      // 開けるので、消さずに残すと「ログアウトしたのに端末を触れば全ノートを
      // 読めて検索もできる」状態になる。
      //
      // サーバ側の成否に関わらず消す (2026-11 の監査 M-8)。ログアウトを押す動機は
      // 「この端末から手を離す」で、圏外でサーバに届かなくても端末側は空にしたい。
      // サーバのセッションが残る心配は、次にオンラインでログアウトし直すか
      // 「他の端末からログアウト」で片付く。どちらの関数も投げない
      await clearOfflineData();
      try {
        clearMemoDrafts(window.localStorage);
      } catch (error) {
        console.warn("下書きを消せませんでした", error);
      }
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isBusy}
      className={
        variant === "menu"
          ? `${HEADER_MENU_ITEM_CLASS} disabled:opacity-60`
          : "inline-flex min-h-11 items-center rounded px-2 text-gray-500 transition-colors hover:text-gray-900 active:bg-gray-100 disabled:opacity-60"
      }
    >
      {/* アイコンはメニューの行のときだけ。ヘッダ直置きの側は文字だけの
          小さなリンクで、アイコンを足すと幅を食う */}
      {variant === "menu" && <LogoutIcon />}
      {isBusy ? "処理中…" : "ログアウト"}
    </button>
  );
}
