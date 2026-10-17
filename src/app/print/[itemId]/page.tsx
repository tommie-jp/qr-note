import type { Metadata } from "next";
import QRCode from "qrcode";
import { LoginRequiredNotice } from "@/components/auth/LoginRequiredNotice";
import { PrintButton } from "@/components/item/PrintButton";
import { getItem } from "@/lib/items/read";
import { guardItemPage } from "@/lib/auth/pageGuard";
import { isPublicItem } from "@/lib/auth/publicItem";
import { currentUser } from "@/lib/auth/session";
import { qrBaseUrl } from "@/lib/site";
import { buildItemUrl } from "@/lib/validation";
import { buildShortItemUrl, noteNumberOf } from "@/lib/items/noteNumber";

export const dynamic = "force-dynamic";

// /item と揃える (docs/22-ノート公開計画.md §8)
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface PrintPageProps {
  params: Promise<{ itemId: string }>;
}

// Ver1 の /print/:itemId 相当。QR シール印刷用ページ。
// QR には https の公開 URL を埋め込む (QR_BASE_URL で変更可能)
//
// 公開ビューにも QR ボタンを出すため、このページも未ログインで開ける
// (docs/22-ノート公開計画.md §5)。ただし**素通しはしない** — /item と同じ
// 公開判定を通す。QR の中身は itemId から誰でも作れるので開けても秘密は
// 漏れないが、規則を揃えることで「公開ノートに関する読み取りだけが公開」の
// 一文で全体を説明できるようにする。例外を 1 つ作ると、次に足す人が
// 「印刷は素通しだから他も」と読む。
export default async function PrintPage({ params }: PrintPageProps) {
  const itemId = await guardItemPage((await params).itemId, (id) => `/print/${id}`);

  const [user, item] = await Promise.all([currentUser(), getItem(itemId)]);
  if (user === null && !isPublicItem(item)) {
    return <LoginRequiredNotice />;
  }
  // QR の下に人が読む名前。もとは #番号 だったが、id (UUID) は人が読む物では
  // ないのでノートの見出しを出す (docs/107 §2-4)。旧番号はタグとして見出しに
  // 出ることがある (本文が画像だけのノート)。作成前の id でもシールは刷れる
  const label = item === null ? "" : item.title;
  // 番号タグ (#1234) がちょうど 1 つなら短縮 URL を載せる (docs/111-短縮URL計画.md §5)。
  // QR が 33x33 → 25x25 になり、番号はポストイットに写して手で打てる。
  // 番号が無い・2 つ以上あるノートは今までどおり id の URL
  const noteNumber = item === null ? null : noteNumberOf(item.tags);

  const itemUrl =
    noteNumber === null
      ? buildItemUrl(qrBaseUrl(), itemId)
      : buildShortItemUrl(qrBaseUrl(), noteNumber);
  const qrDataUrl = await QRCode.toDataURL(itemUrl, {
    margin: 1,
    width: 240,
    errorCorrectionLevel: "M",
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold print:hidden">
        print
      </h1>

      <div className="inline-block border border-gray-300 bg-white p-3 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrDataUrl} alt={`QR: ${itemUrl}`} width={240} height={240} />
        {/* 番号があれば番号が主。手で写すのは番号なので大きく、見出しは添える */}
        {noteNumber !== null && (
          <div className="mt-1 text-2xl font-bold tabular-nums">#{noteNumber}</div>
        )}
        {label !== "" && (
          <div
            className={`mt-1 max-w-[240px] truncate ${noteNumber === null ? "text-lg font-bold" : "text-sm"}`}
          >
            {label}
          </div>
        )}
      </div>

      <p className="break-all text-sm text-gray-500 print:hidden">{itemUrl}</p>
      {noteNumber === null && item !== null && (
        <p className="text-sm text-gray-500 print:hidden">
          ノートの画面で「番号」を押すと、短い QR (/s/1234) になり、番号を手で打って開けます。
        </p>
      )}

      <PrintButton />
    </div>
  );
}
