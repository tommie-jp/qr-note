import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotesExporter } from "@/components/NotesExporter";
import { NotesImporter } from "@/components/NotesImporter";
import { BOX_CLASS } from "@/components/ui";
import { isDemoMode } from "@/lib/appEnv";
import { requireUser } from "@/lib/session";

// サイト名は付けない。root layout の title.template が付ける
export const metadata: Metadata = {
  title: "インポート / エクスポート",
};

// ノートの持ち出し (ZIP 書き出し) と取り込み (ZIP / Evernote .enex) の画面
// (docs/28-エクスポート計画.md §7)。
//
// **書き出す場所と戻す場所を同じ画面に置く**。往復できることがこの機能の要件
// なので、導線が離れていると「戻せる形式なのか」が利用者に伝わらない。
//
// proxy.ts も未ログインの画面 GET を止めるが、それは楽観的な検査であって
// 唯一の砦にはしない (docs/18 §4)。ここでも requireUser() で確かめる。
export default async function ImportSettingsPage() {
  // デモでは取り込みも持ち出しも出さない (docs/38-デモモード計画.md §4)。
  // API 側でも塞ぐが、URL 直打ちに備えてページも 404 に倒す
  if (isDemoMode()) {
    notFound();
  }
  await requireUser();

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-lg font-bold">エクスポート</h1>
        <NotesExporter />
      </section>

      <section className="space-y-3">
        <h1 className="text-lg font-bold">インポート</h1>
        <p className="text-gray-600">
          エクスポートした .zip を選ぶと、中のノートを番号ごと元に戻します。
          同じ番号のノートが既にある場合の扱いは、下で選べます。
        </p>
        <p className={`${BOX_CLASS} py-3 text-gray-600`}>
          Evernote で書き出した .enex
          も選べます。中のノートをこのアプリのノートとして取り込み、番号は空いている
          一番小さい番号から自動で振ります。本文は Markdown
          に変換し、リンクと画像・PDF は引き継ぎますが、フォントと文字サイズの指定は
          落ちます。
        </p>
        <NotesImporter />
      </section>
    </div>
  );
}
