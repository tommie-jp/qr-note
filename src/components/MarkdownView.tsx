import type { Element } from "hast";
import type { PluggableList } from "unified";
import Markdown from "react-markdown";
import { remarkTagLinks } from "./remarkTagLinks";
import { CodeBlock } from "./CodeBlock";
import { rehypeTaskLines, TASK_LINE_PROPERTY } from "./rehypeTaskLines";
import { TaskCheckbox, type ToggleTaskHandler } from "./TaskCheckbox";
import { MermaidDiagram } from "./MermaidDiagram";
import { CircuitDiagram } from "./CircuitDiagram";
import { QuizFence } from "./quiz/QuizFence";
import {
  BASE_REHYPE_PLUGINS,
  BASE_REMARK_PLUGINS,
  blockquoteWithAlert,
  linkWithTarget,
  type MarkdownComponentProps,
  readFence,
  REMARK_REHYPE_OPTIONS,
  urlTransform,
} from "./markdownPipeline";
import { ZoomableImage } from "./ZoomableImage";
import { PdfLink } from "./pdf/PdfLink";
import { AudioPlayer } from "./audio/AudioPlayer";
import { VideoPlayer } from "./video/VideoPlayer";
import { TextLink } from "./text/TextLink";
import { SecretBlock } from "./secret/SecretBlock";
import { BOX_CLASS } from "./ui";
import { parseAltWidth } from "@/lib/altWidth";
import { classifyImgSrc } from "@/lib/imgSrcKind";
import { DEFAULT_SECRET_LABEL } from "@/lib/secrets";
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

// 画像記法の src を種別ごとの部品に振り分ける。判定順は classifyImgSrc
// (markdownPipeline.tsx) に一本化 — 一覧のプレビュー (NotePreviewThumb の
// previewImg) も同じ判定で描くので、順や種類はここでいじらない。
// 画像はクリックで拡大できるよう ZoomableImage で描画し、alt 末尾の
// 幅記法 (parseAltWidth) を表示幅にする。**幅記法を読むのは画像と動画だけ** —
// 音声・PDF・テキスト・シークレットは alt をラベルとして丸ごと使う
// (`![仕様書|80].pdf` のような紛らわしいファイル名を勝手に削らない。
// docs/73-動画幅指定計画.md §3)。
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
    const src = typeof props.src === "string" ? props.src : "";
    const cls = classifyImgSrc(src);
    // シークレット断片 (docs/51-部分暗号化計画.md §3) は**いちばん先** —
    // 中身は暗号文なので、下の <img> に落ちると必ず割れた画像になる。
    // alt がラベル、URL が断片の名前で、どちらも平文のまま本文に残る
    if (cls.kind === "secret") {
      return (
        <SecretBlock
          name={cls.name}
          label={alt || DEFAULT_SECRET_LABEL}
          allowEdit={allowSecretEdit}
        />
      );
    }
    // 復号済みの媒体 (Blob URL)。拡張子が無い (classifyImgSrc は image に
    // 畳む) ので対応表で振り分ける
    const blobKind = blobKinds.get(src);
    if (blobKind === "audio") {
      return <AudioPlayer src={src} label={alt || "audio"} />;
    }
    if (blobKind === "video") {
      const { label, width } = parseAltWidth(alt);
      return <VideoPlayer src={src} label={label || "video"} width={width} />;
    }
    if (cls.kind === "audio") {
      // 音声プレイヤー + 共有ボタン。<audio> は iOS の長押し共有が効かないので、
      // 自前で共有の口を持つ (AudioPlayer.tsx の冒頭に経緯)
      return <AudioPlayer src={src} label={alt || "audio"} />;
    }
    if (cls.kind === "video") {
      // 動画プレイヤー + 共有ボタン (VideoPlayer.tsx)。poster に ?thumb=1 を渡す。
      // 画像と同じ幅記法が効く (docs/73-動画幅指定計画.md)。剥がしたラベルは
      // 共有・保存のファイル名になるので、幅を混ぜたまま渡さない
      const { label, width } = parseAltWidth(alt);
      return <VideoPlayer src={src} label={label || "video"} width={width} />;
    }
    if (cls.kind === "pdf") {
      // alt には挿入時のファイル名が入る (MemoEditorInner の pdfAltText)。
      // 押すとページ内のモーダルで開く (画面遷移しないので standalone PWA でも
      // 確実にノートへ戻れる。PdfLink.tsx の冒頭に経緯)
      return <PdfLink href={src} label={alt || "PDF"} />;
    }
    if (cls.kind === "text") {
      // PDF と同じ扱い。中身は解釈せず、そのままの文字として見せる
      return <TextLink href={src} label={alt || "テキスト"} />;
    }
    const { label, width } = parseAltWidth(alt);
    if (width !== null) {
      return (
        <ZoomableImage
          {...props}
          alt={label}
          width={width}
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
  // プラグイン列の土台は markdownPipeline.tsx (一覧のプレビューと共有)。
  // タグをリンクにしないときはプラグインごと外す。#タグ は text ノードのまま
  // 残るので、本文の見た目は「リンクでない #タグ」になる
  const remarkPlugins: PluggableList = [
    ...BASE_REMARK_PLUGINS,
    ...(linkTags ? [remarkTagLinks] : []),
  ];

  // rehypeTaskLines は**サニタイズより後**に置く (前だと data-line が落ちる)。
  // 押せない画面でも外さない — 出し分けを増やすと、片方だけ直したときに
  // 「静かに押せないだけ」に戻ってしまう。刻むのは行番号だけで実害はない
  const rehypePlugins: PluggableList = [...BASE_REHYPE_PLUGINS, rehypeTaskLines];

  return (
    // 文字サイズの倍率は root (html) に掛かっているので、ここは何も持たない
    // (docs/61-テキストサイズ計画.md)。prose-sm の 0.875rem も rem なので
    // 一緒に伸縮する
    <div
      className={`prose prose-sm max-w-none break-words ${PROSE_TWEAKS} ${BOX_CLASS}`}
    >
      <Markdown
        remarkPlugins={remarkPlugins}
        urlTransform={urlTransform}
        rehypePlugins={rehypePlugins}
        remarkRehypeOptions={REMARK_REHYPE_OPTIONS}
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
