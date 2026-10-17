import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SERVICE_LINKS } from "@/components/chrome/AttributionFooter";
import { YahooAttribution } from "@/components/chrome/YahooAttribution";
import {
  CLAUDE_CODE_URL,
  QR_NOTE_DEMO_URL,
  QR_NOTE_GITHUB_URL,
  THIRD_PARTY_LICENSES_PATH,
  TOMMIE_CIRCUIT_WORKBOOK_GITHUB_URL,
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
import pkg from "../../../package.json";

// クレジット / 帰属表示のページ (docs/46-クレジット表記計画.md)。
//
// **設定系 (パスキー等) と違い、デモでも隠さず・ログイン前でも見せる。**
// Yahoo!デベロッパーネットワークはクレジット表示が義務で、ブラウザへ配る
// JS・フォント・モデルのライセンス表記もここから辿る。どちらも誰に対しても
// 出してよい情報なので、requireUser() も notFound() も掛けず、proxy でも
// 開けてある (auth/publicPaths.ts の CREDIT_PATHS)。
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

// 同梱・取得しているモデルとフォント。npm の依存ではないので一覧の生成器
// (.glf.json) からは見えない。全文は licenses/bundled-models.txt と BaKoMa の
// LICENCE を一覧の末尾に足してあり、ここは要約
const BUNDLED_ASSETS = [
  {
    name: "PP-OCRv5 (PaddleOCR)",
    use: "画像の文字認識 (OCR)",
    license: "Apache-2.0",
  },
  {
    name: "DINOv2 small (Meta, ONNX 変換 Xenova/dinov2-small)",
    use: "画像の類似検索",
    license: "Apache-2.0",
  },
  {
    name: "BaKoMa Fonts (Computer Modern)",
    use: "TikZ の回路図の文字",
    license: "BaKoMa Fonts Licence",
  },
] as const;

const LINK_CLASS = "text-blue-700 underline";

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={LINK_CLASS}
    >
      {children}
    </a>
  );
}

export default function AboutPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-bold">クレジット</h1>
        <p className="text-gray-600">QR Note v{pkg.version}</p>
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
          <ExternalLink href={SERVICE_LINKS.rakutenBooks.href}>
            {SERVICE_LINKS.rakutenBooks.label}
          </ExternalLink>
          を利用しています。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">openBD / 国立国会図書館サーチ (書誌)</h2>
        <p className="text-gray-600">
          書名・著者などの書誌情報は、
          <ExternalLink href={SERVICE_LINKS.openBd.href}>
            {SERVICE_LINKS.openBd.label}
          </ExternalLink>
          および
          <ExternalLink href={SERVICE_LINKS.ndlSearch.href}>
            {SERVICE_LINKS.ndlSearch.label}
          </ExternalLink>
          の提供データを利用しています。
        </p>
      </section>

      {/* 外部へ送るものと送らないもの。送らない側は「サーバにも送らない」まで
          言える処理だけを書く (OCR は ocrWorker、画像検索は索引を取ってきて
          imageSearch.ts で照合する。どちらもブラウザの中で完結する) */}
      <section className="space-y-2">
        <h2 className="font-bold">データの行き先</h2>
        <ul className="list-disc space-y-0.5 pl-5 text-gray-600">
          <li>
            JAN コード・ISBN は、商品名や書誌を調べるために上の Web
            サービスへ送ります。
          </li>
          <li>
            写真の文字認識 (OCR)
            と、カメラで写した物の画像検索は、端末の中で計算します。そのために写真をサーバや外部へ送ることはありません
            (ノートに添付した写真は、保存のためにこのアプリのサーバへ送ります)。
          </li>
          <li>
            文字認識と画像検索のモデルは、初回に読み込みます (画像検索のモデルは
            Hugging Face から取得します)。
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">tommie-fence (図のフェンス)</h2>
        <p className="text-gray-600">
          ノートに書いた回路図・配線図・計器の画面を、Markdown
          のコードフェンスから描く言語のファミリーです。本アプリの図はこれで描いています。
          {/* 公開はまだαバージョン (上流 README) */}
          ソースは
          <ExternalLink href={TOMMIE_FENCE_GITHUB_URL}>
            {TOMMIE_FENCE_GITHUB_URL}
          </ExternalLink>
          で公開しています (MIT)。
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
        <h2 className="font-bold">教科書</h2>
        <p className="text-gray-600">
          電験三種などの教科書のノートの出典は
          <ExternalLink href={TOMMIE_CIRCUIT_WORKBOOK_GITHUB_URL}>
            {TOMMIE_CIRCUIT_WORKBOOK_GITHUB_URL}
          </ExternalLink>
          です (本文 CC BY 4.0)。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">QR Note</h2>
        <p className="text-gray-600">
          本アプリ (QR Note) のソースは
          <ExternalLink href={QR_NOTE_GITHUB_URL}>
            {QR_NOTE_GITHUB_URL}
          </ExternalLink>
          で公開しています (MIT)。デモ版は
          <ExternalLink href={QR_NOTE_DEMO_URL}>
            {QR_NOTE_DEMO_URL}
          </ExternalLink>
          (ログイン demo / demo) です。
        </p>
        {/* 作り方の帰属。外部 API やライブラリと同じく「何を使って作ったか」を
            ここに並べる (README の「開発の進め方」と同じ内容)。判断と確認は
            作者が行う旨も添え、「AI が勝手に作った物」と読まれないようにする */}
        <p className="text-gray-600">
          コードと文書は、作者が
          <ExternalLink href={CLAUDE_CODE_URL}>Claude Code</ExternalLink>
          (Anthropic) と対話しながら書いています。何を作るか・どう決めるかは
          作者が判断し、動作は作者が確かめています。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">オープンソースのライセンス</h2>
        <p className="text-gray-600">
          本アプリは多くのオープンソースソフトウェアを利用しています。npm
          の依存の著作権表示とライセンス文は、
          {/* 同じ出所の静的ファイル。別タブにはしない (戻るで戻れるように) */}
          <a href={THIRD_PARTY_LICENSES_PATH} className={LINK_CLASS}>
            第三者ライセンスの一覧
          </a>
          にまとめています。同梱・取得しているモデルとフォントは次のとおりです
          (全文は同じ一覧の末尾)。
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-gray-600">
          {BUNDLED_ASSETS.map((asset) => (
            <li key={asset.name}>
              {asset.name} — {asset.use} ({asset.license})
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
