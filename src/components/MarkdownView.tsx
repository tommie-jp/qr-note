import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema, type Options } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkTagLinks } from "./remarkTagLinks";
import { MermaidDiagram } from "./MermaidDiagram";
import { CircuitDiagram } from "./CircuitDiagram";
import { ZoomableImage } from "./ZoomableImage";
import { PdfLink } from "./pdf/PdfLink";
import { AudioPlayer } from "./audio/AudioPlayer";
import { VideoPlayer } from "./video/VideoPlayer";
import { TextLink } from "./text/TextLink";
import { SecretBlock } from "./secret/SecretBlock";
import { BOX_CLASS } from "./ui";
import { DEFAULT_SECRET_LABEL, secretNameFromUrl } from "@/lib/secrets";
import { AUDIO_EXTENSION_ALTERNATION } from "@/lib/audioFormats";
import { VIDEO_EXTENSION_ALTERNATION } from "@/lib/videoFormats";
import { TEXT_EXTENSION_ALTERNATION } from "@/lib/textFormats";
import { CIRCUIT_LANG, MERMAID_LANG } from "@/lib/fenceLanguages";
import type { CircuitMap } from "@/lib/circuitCache";
import "katex/dist/katex.min.css";

// rehype-katex は code の math-inline / math-display クラスを目印にするため、
// sanitize で落とされないよう許可する (language-* はデフォルトでも許可)。
// sanitize → katex の順にすることで、ユーザー入力は sanitize 済み・
// KaTeX が生成した HTML はそのまま残る (remark-math 公式レシピ)
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
  protocols: {
    ...defaultSchema.protocols,
    // blob: を許すのはシークレット断片のため (docs/51-部分暗号化計画.md §9)。
    // 断片の中に貼った画像は、復号したバイト列から Blob URL を作って
    // 差し替える — サーバは復号できないので、通常の /api/images では出せない。
    //
    // 緩めても増える攻撃面は無い: blob: URL は自分のオリジンの JS だけが
    // 作れて、本文に手で書いた blob: は何も指さない (無効な URL になる)
    src: [...(defaultSchema.protocols?.src ?? []), "blob"],
  },
} satisfies Options;

// \rule{99999em}{...} のような巨大サイズ指定でページを潰せないよう上限を設ける
// (KaTeX の maxSize デフォルトは Infinity)
const KATEX_MAX_SIZE_EM = 50;

// URL の通し方。react-markdown は**サニタイズより前に**既定の urlTransform
// (https?|ircs?|mailto|xmpp のみ許可) で URL を空文字に潰すため、
// sanitizeSchema の protocols に blob を足すだけでは足りない — シークレット
// 断片内の画像 (復号したバイト列の blob: URL。docs/51 §9) がここで消え、
// alt 文字だけが表示される (実機で発生)。
//
// blob: を通しても攻撃面は増えない: blob: URL は自分のオリジンの JS だけが
// 作れて、本文に手で書いた blob: は何も指さない (sanitizeSchema と同じ理由)。
// それ以外の未知プロトコル (javascript: 等) は今までどおり既定に任せて潰す
function urlTransform(url: string): string {
  return url.startsWith("blob:") ? url : defaultUrlTransform(url);
}

interface MarkdownViewProps {
  markdown: string;
  // ```circuitikz の描画結果 (renderCircuits の戻り値)。
  // TeX の描画は非同期なのにこのコンポーネントは同期に描くため、
  // ページ側で先に済ませた結果を受け取る。渡さなければ回路図フェンスは
  // ただのコードブロックとして表示される
  circuits?: CircuitMap;
  // 本文中の #タグ を検索リンクにするか (docs/22-ノート公開計画.md §4)。
  // 公開ビューでは false にする — 飛び先のタグ検索は未ログインに閉じており、
  // 押すと「ログインが必要です」に化けるため。false でも #タグ の文字は残る
  // (本文の一部なので消さない。リンクにしないだけ)
  linkTags?: boolean;
  // 画像の拡大表示に 90° 回転ボタンを出すか (docs/49-画像回転計画.md §2)。
  // ノート閲覧 (ItemView) からのみ true。回転は保存を伴うので、未ログインの
  // 公開ビュー・docs ページでは出さない (既定 false)
  allowRotate?: boolean;
}

// react-markdown はカスタムコンポーネントに hast の node を渡してくるため、
// DOM 要素へ spread する前に取り除く
type MarkdownComponentProps<T extends "pre" | "a" | "img"> = ComponentProps<T> & {
  node?: unknown;
};

// フェンスの言語と中身を取り出す。フェンスでなければ null
function readFence(
  children: ReactNode,
): { lang: string; code: string } | null {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    return null;
  }
  const lang = /\blanguage-([^\s]+)/.exec(child.props.className ?? "")?.[1];
  if (!lang) {
    return null;
  }
  const code = Children.toArray(child.props.children)
    .filter((c): c is string => typeof c === "string")
    .join("");
  return { lang, code: code.trim() };
}

// フェンスコードの中身 (pre > code) が mermaid / circuitikz なら図に差し替える
function preOrDiagram(circuits: CircuitMap) {
  return function PreOrDiagram({
    node: _node,
    children,
    ...props
  }: MarkdownComponentProps<"pre">) {
    const fence = readFence(children);

    if (fence?.lang === MERMAID_LANG) {
      return <MermaidDiagram code={fence.code} />;
    }

    // 描画済みの結果が無いフェンス (circuits を渡していないページ) は
    // コードブロックのまま表示する
    const circuit = fence?.lang === CIRCUIT_LANG ? circuits.get(fence.code) : undefined;
    if (circuit) {
      return <CircuitDiagram result={circuit} code={fence!.code} />;
    }

    return <pre {...props}>{children}</pre>;
  };
}

// 音声の配信 URL (`/api/images/<uuid>.mp3` など)。エディタは音声を画像記法
// `![audio](url)` で挿入するので (docs/12-添付ファイル種類拡張メモ.md)、img の
// src が音声ならここで <audio> に振り分ける。この <audio> は sanitize 後に
// React が組み立てる要素なので、生 HTML の許可リスト (sanitizeSchema) は要らない。
const AUDIO_SRC_RE = new RegExp(
  `\\.(?:${AUDIO_EXTENSION_ALTERNATION})(?:[?#]|$)`,
  "i",
);

// 動画の配信 URL (`/api/images/<uuid>.mp4` など)。エディタは動画を画像記法
// `![video](url)` で挿入するので (docs/14-動画挿入計画.md)、img の src が動画なら
// <video> に振り分ける。保存名の拡張子は mp4|mkv|mov で、音声の .webm とは
// 重ならない (webm 動画は .mkv で保存される。videoFormats.ts の経緯)。
const VIDEO_SRC_RE = new RegExp(
  `\\.(?:${VIDEO_EXTENSION_ALTERNATION})(?:[?#]|$)`,
  "i",
);

// PDF も同じく画像記法 `![ファイル名.pdf](url)` で本文に入る。インライン
// ビューアは埋め込まず、押したらブラウザ内蔵ビューアが開くリンクにする
// (iPhone との相性がよく、本文が重くならない)
const PDF_SRC_RE = /\.pdf(?:[?#]|$)/i;

// テキスト系 (txt/csv/md) も同じ画像記法で入る。PDF と同じくページ内の
// ビューアで開く (docs/12-添付ファイル種類拡張メモ.md)
const TEXT_SRC_RE = new RegExp(
  `\\.(?:${TEXT_EXTENSION_ALTERNATION})(?:[?#]|$)`,
  "i",
);

// alt 末尾の "|数字" を表示幅 (px) として解釈する (例: ![スクショ|200](/api/images/x.png))。
// 生 HTML を無効にしたまま画像ごとに幅を指定できるようにするための独自記法。
// 画像はクリックで拡大できるよう ZoomableImage で描画する。
// allowRotate なら拡大表示に 90° 回転ボタンを出す (docs/49-画像回転計画.md)
function imgRenderer(allowRotate: boolean) {
  return function ImgWithWidth({
    node: _node,
    alt,
    ...props
  }: MarkdownComponentProps<"img">) {
    // シークレット断片 (docs/51-部分暗号化計画.md §3)。**いちばん先に見る** —
    // 中身は暗号文なので、下の <img> に落ちると必ず割れた画像になる。
    // alt がラベル、URL が断片の名前で、どちらも平文のまま本文に残る
    const secretName =
      typeof props.src === "string" ? secretNameFromUrl(props.src) : null;
    if (secretName !== null) {
      return (
        <SecretBlock name={secretName} label={alt || DEFAULT_SECRET_LABEL} />
      );
    }
    if (typeof props.src === "string" && AUDIO_SRC_RE.test(props.src)) {
      // 音声プレイヤー + 共有ボタン。<audio> は iOS の長押し共有が効かないので、
      // 自前で共有の口を持つ (AudioPlayer.tsx の冒頭に経緯)
      return <AudioPlayer src={props.src} label={alt || "audio"} />;
    }
    if (typeof props.src === "string" && VIDEO_SRC_RE.test(props.src)) {
      // 動画プレイヤー + 共有ボタン (VideoPlayer.tsx)。poster に ?thumb=1 を渡す
      return <VideoPlayer src={props.src} label={alt || "video"} />;
    }
    if (typeof props.src === "string" && PDF_SRC_RE.test(props.src)) {
      // alt には挿入時のファイル名が入る (MemoEditorInner の pdfAltText)。
      // 押すとページ内のモーダルで開く (画面遷移しないので standalone PWA でも
      // 確実にノートへ戻れる。PdfLink.tsx の冒頭に経緯)
      return <PdfLink href={props.src} label={alt || "PDF"} />;
    }
    if (typeof props.src === "string" && TEXT_SRC_RE.test(props.src)) {
      // PDF と同じ扱い。中身は解釈せず、そのままの文字として見せる
      return <TextLink href={props.src} label={alt || "テキスト"} />;
    }
    const match = /^(.*?)\|(\d+)$/.exec(alt ?? "");
    if (match) {
      return (
        <ZoomableImage
          {...props}
          alt={match[1]}
          width={Number(match[2])}
          allowRotate={allowRotate}
        />
      );
    }
    return <ZoomableImage {...props} alt={alt} allowRotate={allowRotate} />;
  };
}

// 外部サイトへのリンクだけ別タブで開く。#タグ の検索リンクやメモへの
// 内部リンク (/... で始まる) までタブを増やすと使いにくいため除く。
// mailto: などもメーラーが起動して空タブが残るだけなので対象外
function isExternalLink(href: string | undefined): boolean {
  return /^https?:\/\//i.test(href ?? "");
}

function linkWithTarget({
  node: _node,
  children,
  ...props
}: MarkdownComponentProps<"a">) {
  // rel="noreferrer" は noopener を兼ねるため、別タブでも opener は渡らない
  const target = isExternalLink(props.href) ? "_blank" : undefined;
  return (
    <a {...props} className="break-all" rel="noreferrer" target={target}>
      {children}
    </a>
  );
}

// memo を Markdown としてレンダリングする Server Component。
// 生 HTML はデフォルトで無視されるが、保険として rehype-sanitize も通す
export function MarkdownView({
  markdown,
  circuits = new Map(),
  linkTags = true,
  allowRotate = false,
}: MarkdownViewProps) {
  // タグをリンクにしないときはプラグインごと外す。#タグ は text ノードのまま
  // 残るので、本文の見た目は「リンクでない #タグ」になる
  const remarkPlugins = [
    remarkGfm,
    remarkBreaks,
    remarkMath,
    ...(linkTags ? [remarkTagLinks] : []),
  ];

  return (
    <div className={`prose prose-sm max-w-none break-words ${BOX_CLASS}`}>
      <Markdown
        remarkPlugins={remarkPlugins}
        urlTransform={urlTransform}
        rehypePlugins={[
          [rehypeSanitize, sanitizeSchema],
          [rehypeKatex, { maxSize: KATEX_MAX_SIZE_EM }],
        ]}
        components={{
          pre: preOrDiagram(circuits),
          img: imgRenderer(allowRotate),
          a: linkWithTarget,
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
