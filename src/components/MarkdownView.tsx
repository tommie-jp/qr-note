import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { Element } from "hast";
import type { PluggableList } from "unified";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkTagLinks } from "./remarkTagLinks";
import { remarkDetails, remarkDetailsSyntax } from "./remarkDetails";
import { alertTypeFromClassName, remarkAlerts } from "./remarkAlerts";
import { MarkdownAlert } from "./MarkdownAlert";
import { CodeBlock } from "./CodeBlock";
import { rehypeTaskLines, TASK_LINE_PROPERTY } from "./rehypeTaskLines";
import { TaskCheckbox, type ToggleTaskHandler } from "./TaskCheckbox";
import { MermaidDiagram } from "./MermaidDiagram";
import { CircuitDiagram } from "./CircuitDiagram";
import { QuizFence } from "./quiz/QuizFence";
import {
  KATEX_OPTIONS,
  linkWithTarget,
  sanitizeSchema,
  urlTransform,
} from "./markdownPipeline";
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
import { CIRCUIT_LANG, MERMAID_LANG, QUIZ_LANG } from "@/lib/fenceLanguages";
import type { CircuitMap } from "@/lib/circuitCache";
import "katex/dist/katex.min.css";

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
  // シークレット断片の展開表示に「編集」を出すか
  // (docs/52-シークレット編集導線計画.md §2)。allowRotate と同じ作法で
  // ノート閲覧 (ItemView) からのみ true — 保存を伴うので、未ログインの
  // 公開ビュー・印刷・docs ページでは出さない (既定 false)
  allowSecretEdit?: boolean;
  // Blob URL がどの種別かの対応表 (docs/53-シークレット挿入拡張計画.md §5)。
  //
  // 音声・動画・PDF の描き分けは URL の拡張子で行っているが、シークレット断片の
  // 中の媒体は**復号したバイト列の Blob URL** で、拡張子を持たない。URL に
  // 細工をする (`#x.mp3` を足す) のは行儀が悪いので、種別を明示的に渡す。
  // 非同期に用意した結果を呼び出し側から渡すのは circuits と同じ作法
  blobKinds?: ReadonlyMap<string, "image" | "audio" | "video">;
  // タスクリスト (`- [ ]`) のチェックボックスを押したときの保存処理
  // (docs/55-チェックボックス操作計画.md §5)。省略すると押せないまま
  // (GFM 既定の disabled な表示)。
  //
  // allowRotate のような「許可の真偽値」ではなく処理そのものを受けるのは、
  // このコンポーネントに「どのノートか」を持ち込まないため — ここは本文の
  // 描き方だけを知っていればよい。渡すのはノート閲覧 (ItemView) だけで、
  // 押すと保存が走るので公開ビュー・印刷・docs ページでは渡さない。
  // **シークレット断片の中でも渡さない** (断片は独立に描かれるので行番号が
  // メモ本文と一致しない)
  onToggleTask?: ToggleTaskHandler;
}

// react-markdown はカスタムコンポーネントに hast の node を渡してくるため、
// DOM 要素へ spread する前に取り除く
type MarkdownComponentProps<
  T extends "pre" | "a" | "img" | "input" | "blockquote",
> = ComponentProps<T> & {
  node?: unknown;
};

// フェンスの言語と中身を取り出す。<pre> の中が <code> でなければ null。
// **言語指定がなければ lang は null** (字下げのコードブロックもここに来る) —
// コピーボタンは言語の有無によらず出したいので、言語なしを弾かない
function readFence(
  children: ReactNode,
): { lang: string | null; code: string } | null {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    return null;
  }
  const lang =
    /\blanguage-([^\s]+)/.exec(child.props.className ?? "")?.[1] ?? null;
  const code = Children.toArray(child.props.children)
    .filter((c): c is string => typeof c === "string")
    .join("");
  return { lang, code: code.trim() };
}

// フェンスコードの中身 (pre > code) が mermaid / circuitikz なら図に、
// quiz なら問題カードに差し替え、それ以外はコピーボタン付きのコードブロックに
// する (docs/54 §1、docs/58-CBT問題集計画.md §1)
function preOrDiagram(circuits: CircuitMap) {
  return function PreOrDiagram({
    node: _node,
    children,
    ...props
  }: MarkdownComponentProps<"pre">) {
    const fence = readFence(children);
    if (fence === null) {
      return <pre {...props}>{children}</pre>;
    }

    if (fence.lang === MERMAID_LANG) {
      return <MermaidDiagram code={fence.code} />;
    }

    // 図と違い描画に外部ライブラリも事前処理も要らない (中身は本文だけで
    // 完結する) ので、渡されるものは無く、ここで解いてそのまま描く
    if (fence.lang === QUIZ_LANG) {
      return <QuizFence code={fence.code} />;
    }

    // 描画済みの結果が無いフェンス (circuits を渡していないページ) は
    // コードブロックのまま表示する
    if (fence.lang === CIRCUIT_LANG) {
      const circuit = circuits.get(fence.code);
      if (circuit) {
        return <CircuitDiagram result={circuit} code={fence.code} />;
      }
    }

    // 図はコピーしても意味のある文字にならないので、ここまで来たものだけ。
    // 中身は CodeBlock が描いた <pre> から読むので渡さない (二重に送らない)
    return <CodeBlock {...props}>{children}</CodeBlock>;
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
function imgRenderer(
  allowRotate: boolean,
  allowSecretEdit: boolean,
  blobKinds: ReadonlyMap<string, "image" | "audio" | "video">,
) {
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
        <SecretBlock
          name={secretName}
          label={alt || DEFAULT_SECRET_LABEL}
          allowEdit={allowSecretEdit}
        />
      );
    }
    // 復号済みの媒体 (Blob URL)。拡張子が無いので対応表で振り分ける
    const blobKind =
      typeof props.src === "string" ? blobKinds.get(props.src) : undefined;
    if (blobKind === "audio") {
      return <AudioPlayer src={props.src as string} label={alt || "audio"} />;
    }
    if (blobKind === "video") {
      return <VideoPlayer src={props.src as string} label={alt || "video"} />;
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

// rehypeTaskLines が刻んだ行番号を hast ノードから読む (docs/55 §2)。
// 刻まれていない = タスクリストのチェックボックスではない
function taskLineOf(node: unknown): number | null {
  const value = (node as Element | undefined)?.properties?.[TASK_LINE_PROPERTY];
  return typeof value === "number" ? value : null;
}

// GFM のチェックボックスを押せるものに差し替える (docs/55-チェックボックス操作計画.md)。
// サニタイズは input へ disabled を必ず付け直すため、スキーマを緩めても押せる
// ようにはならない。**サニタイズの後に React が自前で組み立てる**この差し替えが
// 正攻法 (img / a / pre と同じ手)。
//
// 出し分けはここ 1 か所に寄せる — onToggleTask を渡されない画面では GFM 既定の
// disabled な input をそのまま描く。呼ぶ側で components ごと出し入れすると、
// 出し分けの条件が 2 か所に増えて片方だけ直す事故が起きる (imgRenderer が
// allowRotate を内側で見ているのと同じ作法)
function taskCheckboxRenderer(onToggleTask: ToggleTaskHandler | undefined) {
  return function TaskCheckboxInput({
    node,
    ...props
  }: MarkdownComponentProps<"input">) {
    const line = taskLineOf(node);
    if (onToggleTask === undefined || props.type !== "checkbox" || line === null) {
      return <input {...props} />;
    }
    return (
      <TaskCheckbox
        line={line}
        initialChecked={props.checked === true}
        onToggle={onToggleTask}
      />
    );
  };
}

// remarkAlerts が刻んだ class を読んでアラートの枠に差し替える (docs/54 §2)。
// 目印の無い引用 (知らない種類の `[!FOO]` を含む) はただの引用のまま
function blockquoteWithAlert({
  node: _node,
  children,
  className,
  ...props
}: MarkdownComponentProps<"blockquote">) {
  const type = alertTypeFromClassName(className);
  if (type === null) {
    return <blockquote {...props}>{children}</blockquote>;
  }
  return <MarkdownAlert type={type}>{children}</MarkdownAlert>;
}

// prose の既定に対する手直し。
// - タスク項目の中黒は落とす。チェックボックスと二重の目印になって読みにくい
//   (字下げは残して他の箇条書きと行頭を揃える)
// - 脚注の塊 (section.footnotes) の上に区切り線を引く。見出し「脚注」は
//   remark-rehype が sr-only で置くので画面には出ず、線がないと本文の続きに
//   見える (docs/54-markdown表示拡張計画.md §3)
const PROSE_TWEAKS =
  "[&_li.task-list-item]:list-none [&_.footnotes]:mt-6 [&_.footnotes]:border-t [&_.footnotes]:border-gray-300 [&_.footnotes]:pt-2";

// memo を Markdown としてレンダリングする Server Component。
// 生 HTML はデフォルトで無視されるが、保険として rehype-sanitize も通す
export function MarkdownView({
  markdown,
  circuits = new Map(),
  linkTags = true,
  allowRotate = false,
  allowSecretEdit = false,
  blobKinds = new Map(),
  onToggleTask,
}: MarkdownViewProps) {
  // タグをリンクにしないときはプラグインごと外す。#タグ は text ノードのまま
  // 残るので、本文の見た目は「リンクでない #タグ」になる。
  //
  // remarkDetails は **remarkBreaks より前**に置く — 知らない directive を
  // 原文の文字に戻すとき、戻した中の改行も他の本文と同じように改行として
  // 描かせたいため (後ろに置くと 1 行に潰れて見える)
  const remarkPlugins = [
    remarkGfm,
    remarkDetailsSyntax,
    remarkDetails,
    remarkBreaks,
    remarkMath,
    remarkAlerts,
    ...(linkTags ? [remarkTagLinks] : []),
  ];

  // rehypeTaskLines は**サニタイズより後**に置く (前だと data-line が落ちる)。
  // 押せない画面でも外さない — 出し分けを増やすと、片方だけ直したときに
  // 「静かに押せないだけ」に戻ってしまう。刻むのは行番号だけで実害はない
  const rehypePlugins: PluggableList = [
    [rehypeSanitize, sanitizeSchema],
    [rehypeKatex, KATEX_OPTIONS],
    rehypeTaskLines,
  ];

  return (
    <div
      className={`prose prose-sm max-w-none break-words ${PROSE_TWEAKS} ${BOX_CLASS}`}
    >
      <Markdown
        remarkPlugins={remarkPlugins}
        urlTransform={urlTransform}
        rehypePlugins={rehypePlugins}
        // 脚注まわりの文言 (docs/54 §3)。既定は英語の "Footnotes" で、
        // 隠し見出しに付く sr-only class はサニタイズで落ちるため画面に出る
        remarkRehypeOptions={{
          footnoteLabel: "脚注",
          footnoteBackLabel: "本文に戻る",
        }}
        components={{
          pre: preOrDiagram(circuits),
          img: imgRenderer(allowRotate, allowSecretEdit, blobKinds),
          a: linkWithTarget,
          input: taskCheckboxRenderer(onToggleTask),
          blockquote: blockquoteWithAlert,
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
