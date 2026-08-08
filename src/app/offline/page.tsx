import type { Metadata } from "next";
import { OfflineApp } from "@/components/offline/OfflineApp";
import { PageTransition } from "@/components/PageTransition";

export const metadata: Metadata = { title: "オフライン" };

// オフラインでノートを探して読む画面 (docs/65-オフライン対応計画.md §3-4)。
//
// **サーバから何も読まない**のが、このページが他と決定的に違うところ。
// ノートは IndexedDB にあり、描画に要るのはこの殻だけ。だからこそ Service
// Worker が 1 枚の HTML として保存でき、圏外でもそのまま開ける。
//
// publicPaths.ts に載せてログイン不要にしてある。理由は 2 つ:
//
//   1. **殻の保存を確実にするため。** 未ログインだと proxy.ts が 200 のまま
//      ログイン案内へ差し替えるので、閉じたままだと「ノートのつもりで
//      ログイン画面」がキャッシュに沈む余地が残る。
//   2. **セッションが切れても手元のノートは読めるべきだから。** 圏外では
//      ログインし直せない。中身は端末の IndexedDB にしか無く、この HTML
//      自体はノートを 1 件も含まない (誰に配っても漏れる情報が無い)。
export default function OfflinePage() {
  return (
    // data-offline-shell … sw.js が「取れた HTML が本当に /offline か」を
    // 確かめる目印 (ログイン案内も 200 で返るので status では見分けられない)。
    // 消すとオフラインの暖機が黙って失敗するので、対で残すこと
    <div data-offline-shell="1">
      <PageTransition>
        <OfflineApp />
      </PageTransition>
    </div>
  );
}
