import type { Blockquote, Paragraph, Root } from "mdast";
import { visit } from "unist-util-visit";
import {
  ALERT_TYPES,
  readAlertMarker,
  type AlertType,
} from "@/lib/markdownAlerts";

// GitHub 互換のアラート記法 (`> [!NOTE]`) を blockquote の class に写す
// remark プラグイン (docs/54-markdown表示拡張計画.md §2)。
//
// **見た目はここでは組み立てない。** 目印を class に置き換えるだけで、枠・色・
// アイコンは MarkdownAlert が**サニタイズの後に React で**組み立てる。
// 既製の remark-github-blockquote-alert を使わないのはこれが理由で、あちらは
// SVG アイコン入りの HTML を吐く — このアプリのサニタイズは svg を通さないので、
// 通そうとすると増える攻撃面のほうが先に大きくなる。
//
// 記法そのものはただの引用なので、GitHub や Obsidian に貼っても壊れない。
// 目印の綴り (どれが有効な種類か) は @/lib/markdownAlerts が持つ。

// blockquote に刻む class。`alert-<種類>` の形だけを許可リストに載せる
// (MarkdownView の sanitizeSchema)
export const ALERT_CLASS_PREFIX = "alert-";

function alertClassName(type: AlertType): string {
  return `${ALERT_CLASS_PREFIX}${type}`;
}

export function alertTypeFromClassName(
  className: string | undefined,
): AlertType | null {
  const classes = new Set(className?.split(/\s+/));
  return ALERT_TYPES.find((type) => classes.has(alertClassName(type))) ?? null;
}

// 引用の 1 つ目の段落の先頭が目印なら、種類と**目印を取り除いた段落**を返す。
// 判定と取り除きを 1 つにしているのは、目印を 2 度読まないため
function readMarker(
  node: Blockquote,
): { type: AlertType; paragraph: Paragraph } | null {
  const paragraph = node.children[0];
  if (paragraph?.type !== "paragraph") {
    return null;
  }
  const [text, ...rest] = paragraph.children;
  if (text?.type !== "text") {
    return null;
  }
  const marker = readAlertMarker(text.value);
  if (marker === null) {
    return null;
  }
  const children =
    marker.rest !== ""
      ? [{ ...text, value: marker.rest }, ...rest]
      : // 目印だけの行だったので、remarkBreaks が置いた改行ごと落とす。
        // 残すと本文の頭に空行が 1 つ入る
        rest[0]?.type === "break"
        ? rest.slice(1)
        : rest;
  return { type: marker.type, paragraph: { ...paragraph, children } };
}

export function remarkAlerts() {
  return (tree: Root): void => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const marker = readMarker(node);
      if (marker === null) {
        return;
      }
      const [, ...rest] = node.children;
      // 目印しか書かれていない引用は、空の段落を残さない
      node.children =
        marker.paragraph.children.length > 0
          ? [marker.paragraph, ...rest]
          : rest;
      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          className: [alertClassName(marker.type)],
        },
      };
    });
  };
}
