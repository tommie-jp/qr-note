import type { Metadata } from "next";
import { PasskeyManager, type PasskeyRow } from "@/components/PasskeyManager";
import { formatJstDateTime } from "@/lib/datetime";
import { requireSettingsPage } from "@/lib/pageGuard";
import { listPasskeys } from "@/lib/auth/passkeys";
import { isPasskeyEnabled } from "@/lib/auth/webauthnConfig";

// サイト名は付けない。root layout の title.template が付ける
export const metadata: Metadata = {
  title: "パスキーの設定",
};

// パスキーの管理画面 (docs/29-パスキー計画.md §8)。
//
// **ここが登録の門番そのもの**。requireUser() を通らないと開けないので、
// パスキーを足せるのは既にログインしている人だけになる。初回はパスワード
// (Basic) で入って登録し、2 台目からはパスキーで入ったまま追加できる。
//
// proxy.ts も未ログインの画面 GET を止めるが、それは楽観的な検査であって
// 唯一の砦にはしない (docs/18 §4)。
export default async function PasskeySettingsPage() {
  // デモでは設定系を出さない (docs/38-デモモード計画.md §4)。導線 (ヘッダの
  // リンク) も隠すが、URL 直打ちに備えてページ側でも 404 に倒す
  await requireSettingsPage();

  const passkeys = await listPasskeys();

  // 日付はここで文字列にしてから降ろす。Date のままクライアントへ渡すと、
  // サーバとブラウザで書式・タイムゾーンがずれて hydration mismatch になる
  const rows: PasskeyRow[] = passkeys.map((passkey) => ({
    id: passkey.id,
    label: passkey.label,
    createdAt: formatJstDateTime(passkey.createdAt),
    lastUsedAt:
      passkey.lastUsedAt === null ? null : formatJstDateTime(passkey.lastUsedAt),
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-bold">パスキーの設定</h1>
        <p className="text-gray-600">
          パスキーを登録すると、次回から Face ID / Touch ID
          だけでログインできます。パスワードでのログインは残るので、
          パスキーを失っても入れなくなることはありません。
        </p>
      </div>
      <PasskeyManager passkeys={rows} isEnabled={isPasskeyEnabled()} />
    </div>
  );
}
