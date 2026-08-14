import type { Element, Root, RootContent } from "hast";
import { visit } from "unist-util-visit";
import { ANSWER_SPOILER_CLASS } from "@/lib/answerSpoiler";
import { trailingHeadword } from "@/lib/vocabTts";

// 答え隠し `||答え||` の span に、その行の**見出し語**を刻む rehype プラグイン
// (docs/81-単語TTS発音計画.md)。単語の発音ボタンが何を読み上げるかを決める。
//
// 単語帳の 1 行はこう書かれている (本番 #1128):
//
//   - [x] concise [🔊](…) ||/kənˈsaɪs/ 簡潔な、要領を得た His answer …||
//         └ 見出し語        └ ここが span になる
//
// 見出し語は答えの**外**にあるので、答えを描く部品 (AnswerSpoiler) からは
// 見えない。同じ親の中で span より前にある文字を見て、ここで刻んでおく。
//
// **rehype-sanitize の後に走らせること。** 前に置くと属性ごと落ちる。値は
// 本文から取った英字だけで、利用者が任意の属性を差し込む余地は無いので
// スキーマを緩める必要はない (rehypeTaskLines と同じ作法)。

// hast のプロパティ名。react-markdown が components に渡す node から読める
export const TTS_WORD_PROPERTY = "dataTtsWord";

function isSpoiler(node: RootContent): node is Element {
  if (node.type !== "element") {
    return false;
  }
  const className = node.properties?.className;
  return Array.isArray(className) && className.includes(ANSWER_SPOILER_CLASS);
}

// 節の中の文字をつなぐ (要素なら子孫まで)。
function textOf(node: RootContent): string {
  if (node.type === "text") {
    return node.value;
  }
  if (node.type !== "element") {
    return "";
  }
  return node.children.map(textOf).join("");
}

const HAS_LETTER_RE = /[A-Za-z]/;

// span より前にある文字を集める。
//
// **要素は、中に英字があるときだけ拾う。** 間に挟まるのは飾りで、2 種類ある:
//
//   飾りだけの要素 … チェックボックスの <input>、🔊 のリンク。英字を持たない
//                    ので落ちる。拾うと " concise 🔊 " となり、末尾が英字で
//                    なくなって見出し語が取れなくなる
//   語そのものの飾り … `**concise**` や `[concise](…)`。英字を持つので拾う。
//                      落とすと見出し語が取れず、単語のボタンが黙って消える
//
// 落ちた要素は文字を残さないので、前後がつながって
// `- [x] concise [🔊](…) ||…||` から " concise " が残る。
//
// 1 行に答えが 2 つあるときは、直前の答えより後ろだけを見る
// (前の語の見出しを引きずらない)
function textBefore(siblings: readonly RootContent[]): string {
  let text = "";
  for (const node of siblings) {
    if (isSpoiler(node)) {
      text = "";
      continue;
    }
    const value = textOf(node);
    if (node.type === "text" || HAS_LETTER_RE.test(value)) {
      text += value;
    }
  }
  return text;
}

export function rehypeAnswerTts() {
  return (tree: Root): void => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (!isSpoiler(node) || parent === undefined || index === undefined) {
        return;
      }
      const word = trailingHeadword(textBefore(parent.children.slice(0, index)));
      // 取れなければ何も刻まない = 単語のボタンを出さない。単語帳でない
      // `||答え||` (電験ノートなど) はここで素通りする
      if (word !== null && node.properties !== undefined) {
        node.properties[TTS_WORD_PROPERTY] = word;
      }
    });
  };
}

// react-markdown が components に渡す node から見出し語を読む
// (MarkdownView の taskLineOf と同じ作法)
export function ttsWordOf(node: unknown): string | null {
  const value = (node as Element | undefined)?.properties?.[TTS_WORD_PROPERTY];
  return typeof value === "string" ? value : null;
}
