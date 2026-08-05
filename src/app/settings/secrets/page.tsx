import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SecretKeyringManager } from "@/components/secret/SecretKeyringManager";
import { isDemoMode } from "@/lib/appEnv";
import { requireUser } from "@/lib/session";
import { isPasskeyEnabled } from "@/lib/webauthnConfig";

// サイト名は付けない。root layout の title.template が付ける
export const metadata: Metadata = {
  title: "シークレットの設定",
};

// シークレット (部分暗号化) の設定画面 (docs/51-部分暗号化計画.md §6)。
//
// 鍵の操作はすべてブラウザで行うので、このページはログインの門番と説明だけを
// 持つ。マスターキーはここを含めどのサーバ処理にも現れない。
export default async function SecretSettingsPage() {
  // デモでは機能ごと閉じる (docs/51 §10)。鍵を共有アカウントで分け合えないため。
  // 導線も隠すが、URL 直打ちに備えてページ側でも 404 に倒す (passkeys と同じ)
  if (isDemoMode()) {
    notFound();
  }
  await requireUser();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-bold">シークレットの設定</h1>
        <p className="text-gray-600">
          ノートの機微な部分だけを、この端末の中で暗号化して保存します。
          サーバ (と管理者) が読めるのはラベルだけで、中身は読めません。
          鍵はパスキー (Face ID) から作り、サーバには包んだ鍵しか置きません。
        </p>
      </div>

      {!isPasskeyEnabled() && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          この環境ではパスキーが無効です (WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN
          が未設定)。パスキーを登録してから設定してください。
        </p>
      )}

      <SecretKeyringManager />

      <section className="space-y-1 text-sm text-gray-600">
        <h2 className="font-bold text-gray-700">承知しておくこと</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            本文に書くラベル (「銀行のパスワード」など) は平文のまま残ります。
            隠せるのは中身だけです。
          </li>
          <li>
            復旧キーとパスキーを両方失うと、シークレットは永久に読めません。
          </li>
          <li>
            すでに平文で保存したものは、過去のバックアップには平文のまま
            残ります。
          </li>
          <li>シークレットの中身は全文検索の対象になりません。</li>
        </ul>
      </section>
    </div>
  );
}
