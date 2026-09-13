import type { BlockContent, Paragraph, Parent, Root, RootContent } from "mdast";
import { directiveFromMarkdown } from "mdast-util-directive";
import { directive } from "micromark-extension-directive";
import type { Processor } from "unified";
import type { VFile } from "vfile";
import { SKIP, visit } from "unist-util-visit";

// `:::details[ラベル]` を折りたたみ (details/summary) にする
// (docs/54-markdown表示拡張計画.md §4)。中身は通常の Markdown のまま描かれ、
// details はブラウザが自前で開閉するので client component は要らない
// (MarkdownView は Server Component のままでいられる)。

export const DETAILS_DIRECTIVE = "details";

// ラベルを省いたときの見出し
const DEFAULT_SUMMARY = "詳細";

// 囲いの終わりの行 (`:::`)
const CLOSING_FENCE = /^:{3,}\s*$/;

// コロンの文字コード。micromark はトークナイザをこの番号で引く
const COLON = 58;

// **remark-directive をそのまま使わない。**
// あれは text (`:name`) / leaf (`::name`) / container (`:::name`) の 3 つを
// まとめて有効にする。とくに text 記法はコロンの直後が英数字なら何でも拾うので、
// `型:int` や `時刻 12:30:45` といった何気ない本文まで構文として食われ、
// 既定では中身だけ残した <div> になる — 書いた本人には「なぜか消えた」としか
// 見えない。ここで要るのは `:::details` だけなので、container のトークナイザ
// だけを登録して残り 2 つは有効にしない。
// (`::note[x]` や `型:int` がただの文字のままであることはテストで固定している)
export function remarkDetailsSyntax(this: Processor): undefined {
  const data = this.data();
  const micromarkExtensions = (data.micromarkExtensions ??= []);
  const fromMarkdownExtensions = (data.fromMarkdownExtensions ??= []);
  // micromark-extension-directive が返す flow[58] は [container, leaf] の順
  const flow = directive().flow?.[COLON];
  const container = Array.isArray(flow) ? flow[0] : flow;
  if (container === undefined) {
    // 取り出せないまま素通りさせると `:::details` が黙ってただの文字になる。
    // 依存を上げて形が変わったらここで気づけるようにする
    throw new Error("directive の container トークナイザを取り出せません");
  }
  micromarkExtensions.push({ flow: { [COLON]: [container] } });
  fromMarkdownExtensions.push(directiveFromMarkdown());
}

interface DirectiveNode extends Parent {
  type: "containerDirective";
  name: string;
  children: BlockContent[];
}

function isContainerDirective(node: unknown): node is DirectiveNode {
  return (node as { type?: string }).type === "containerDirective";
}

// `:::details[ラベル]` の [ラベル] は、directiveLabel 印の付いた段落として
// 先頭に入る (mdast-util-directive の約束)
function isLabel(node: RootContent | undefined): node is Paragraph {
  return node?.type === "paragraph" && node.data?.directiveLabel === true;
}

function toDetails(node: DirectiveNode): void {
  const [first, ...rest] = node.children;
  const labeled = isLabel(first);
  const summary: Paragraph = {
    type: "paragraph",
    data: { hName: "summary" },
    children: labeled ? first.children : [{ type: "text", value: DEFAULT_SUMMARY }],
  };
  node.data = { ...node.data, hName: DETAILS_DIRECTIVE };
  node.children = [summary, ...(labeled ? rest : node.children)];
}

function markerParagraph(value: string): Paragraph {
  return { type: "paragraph", children: [{ type: "text", value }] };
}

// 知らない囲い (`:::foo`) は**中身をそのまま残し、囲いの行だけ文字で見せる**。
// mdast-util-to-hast の既定は中身だけ残した <div> で、`:::foo` の行が黙って
// 消える。かといって原文まるごとを 1 つの文字にして戻すと、中の **太字** や
// リンクまで文字に潰れてしまう (Docusaurus 等から `:::tip` ごと貼ったときに効く)
function keepAsWritten(node: DirectiveNode, source: string): RootContent[] {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    return node.children;
  }
  const lines = source.slice(start, end).split("\n");
  const closing = lines.at(-1) ?? "";
  return [
    markerParagraph(lines[0]),
    ...node.children,
    // 閉じずに本文が終わっていることもある
    ...(CLOSING_FENCE.test(closing) ? [markerParagraph(closing)] : []),
  ];
}

export function remarkDetails() {
  return (tree: Root, file: VFile): undefined => {
    const source = String(file.value);
    visit(tree, (node, index, parent) => {
      if (!isContainerDirective(node)) {
        return;
      }
      if (node.name === DETAILS_DIRECTIVE) {
        toDetails(node);
        // 入れ子の :::details も畳めるよう、中は歩き続ける
        return;
      }
      if (parent === undefined || index === undefined) {
        return;
      }
      const written = keepAsWritten(node, source);
      parent.children.splice(index, 1, ...(written as typeof parent.children));
      // 戻した囲いの行を読み直さず、中身の続きから歩く
      return [SKIP, index + 1];
    });
  };
}
