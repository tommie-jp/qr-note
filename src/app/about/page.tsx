import type { Metadata } from "next";
import { SERVICE_LINKS } from "@/components/chrome/AttributionFooter";
import { YahooAttribution } from "@/components/chrome/YahooAttribution";
import {
  QR_NOTE_DEMO_URL,
  QR_NOTE_GITHUB_URL,
  TOMMIE_FENCE_GITHUB_URL,
} from "@/lib/projectLinks";
import { VERSION as breadboardVersion } from "breadboard-fence/core";
import { VERSION as circuitVersion } from "circuit-fence/core";
import { VERSION as copperVersion } from "copper-fence/core";
import { VERSION as graphVersion } from "graph-fence/core";
import { VERSION as logicVersion } from "logic-fence/core";
import { VERSION as perfboardVersion } from "perfboard-fence/core";
import { VERSION as scopeVersion } from "scope-fence/core";
import { VERSION as spectrumVersion } from "spectrum-fence/core";
import { VERSION as vnaVersion } from "vna-fence/core";

// クレジット / 帰属表示のページ (docs/46-クレジット表記計画.md)。
//
// **設定系 (パスキー等) と違い、デモでも隠さず・ログイン前でも見せてよい。**
// Yahoo!デベロッパーネットワークはクレジット表示が義務で、外部 API を使う
// 事実は誰に対しても表示してよい情報なので、requireUser() も notFound() も
// 掛けない。
//
// サイト名は付けない。root layout の title.template が付ける
export const metadata: Metadata = {
  title: "クレジット",
};

// tommie-fence の fence ごとの版。版は fence ごとに独立していて揃えない
// (上流の方針) ので、取り込み済みの tgz の VERSION をそのまま並べる。
// 手で書かないので、tgz を差し替えれば表も追随する
const FENCES = [
  {
    name: "circuit-fence",
    fence: "circuit",
    label: "回路図",
    version: circuitVersion,
  },
  {
    name: "breadboard-fence",
    fence: "bread",
    label: "ブレッドボードの配線図",
    version: breadboardVersion,
  },
  {
    name: "perfboard-fence",
    fence: "perf",
    label: "ユニバーサル基板の配線図",
    version: perfboardVersion,
  },
  {
    name: "copper-fence",
    fence: "copper",
    label: "銅張り基板の寸法図",
    version: copperVersion,
  },
  { name: "vna-fence", fence: "vna", label: "VNA の画面", version: vnaVersion },
  {
    name: "scope-fence",
    fence: "scope",
    label: "オシロスコープの画面",
    version: scopeVersion,
  },
  {
    name: "spectrum-fence",
    fence: "spectrum",
    label: "スペクトラムの画面",
    version: spectrumVersion,
  },
  {
    name: "graph-fence",
    fence: "graph",
    label: "x-y グラフ",
    version: graphVersion,
  },
  {
    name: "logic-fence",
    fence: "logic",
    label: "ロジックアナライザの画面",
    version: logicVersion,
  },
] as const;

// このアプリが使う Web サービスの帰属表示 (docs/46 §1)。
export default function AboutPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-bold">クレジット</h1>
        <p className="text-gray-600">
          本アプリは、書籍・商品情報の取得に以下の Web
          サービスを利用しています。
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="font-bold">Yahoo!ショッピング (JAN 商品情報)</h2>
        <p className="text-gray-600">
          JAN コードからの商品名・ブランドの取得に、Yahoo!ショッピング商品検索
          API を利用しています。
        </p>
        <YahooAttribution />
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">楽天ブックス (書影)</h2>
        <p className="text-gray-600">
          書影 (カバー画像) の取得に、
          {/* 汎用トップではなく、実際に叩いている書籍検索 API のドキュメントへ
              (URL は SERVICE_LINKS に集約。docs/95) */}
          <a
            href={SERVICE_LINKS.rakutenBooks.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            {SERVICE_LINKS.rakutenBooks.label}
          </a>
          を利用しています。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">openBD / 国立国会図書館サーチ (書誌)</h2>
        <p className="text-gray-600">
          書名・著者などの書誌情報は、
          <a
            href={SERVICE_LINKS.openBd.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            {SERVICE_LINKS.openBd.label}
          </a>
          および
          <a
            href={SERVICE_LINKS.ndlSearch.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            {SERVICE_LINKS.ndlSearch.label}
          </a>
          の提供データを利用しています。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">tommie-fence (図のフェンス)</h2>
        <p className="text-gray-600">
          ノートに書いた回路図・配線図・計器の画面を、Markdown
          のコードフェンスから描く言語のファミリーです。本アプリの図はこれで描いています。
          {/* 公開はまだαバージョン (上流 README) */}
          ソースは
          <a
            href={TOMMIE_FENCE_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            {TOMMIE_FENCE_GITHUB_URL}
          </a>
          で公開しています。
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-gray-600">
          {FENCES.map((f) => (
            <li key={f.name}>
              {f.name} {f.version} — <code>{f.fence}</code> ({f.label})
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">QR Note</h2>
        <p className="text-gray-600">
          本アプリ (QR Note) のソースは
          <a
            href={QR_NOTE_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            {QR_NOTE_GITHUB_URL}
          </a>
          で公開しています。デモ版は
          <a
            href={QR_NOTE_DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            {QR_NOTE_DEMO_URL}
          </a>
          (ログイン demo / demo) です。
        </p>
      </section>
    </div>
  );
}
