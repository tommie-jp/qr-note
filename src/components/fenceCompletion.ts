import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { FENCE_LANGUAGES } from "@/lib/markdown/fenceLanguages";

// フェンス開始行 (``` または ~~~ の直後に言語名の途中まで) にマッチする。
// context.matchBefore は行頭から 250 文字までしか遡らないため使わず、
// 行テキストを直接見る (長いメモで ^ が壊れないように)
const FENCE_OPEN = /^\s{0,3}(?:`{3,}|~{3,})([\w-]*)$/;

// ```<言語> を打っている最中に、対応言語の候補を出す補完ソース。
// markdownLanguage.data.of({ autocomplete }) 経由で登録すると、
// lang-markdown 組み込みの補完 (HTML タグ) と共存する
export function fenceLanguageCompletion(
  context: CompletionContext,
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = FENCE_OPEN.exec(before);
  if (!match) {
    return null;
  }

  // 開きフェンスと閉じフェンスは構文木上どちらも CodeMark < FencedCode に
  // 解決される。FencedCode が前の行から始まっていれば閉じフェンスなので出さない
  let node = syntaxTree(context.state).resolveInner(context.pos, -1);
  while (node.parent && node.name !== "FencedCode") {
    node = node.parent;
  }
  if (node.name === "FencedCode" && node.from < line.from) {
    return null;
  }

  const typed = match[1];
  return {
    from: context.pos - typed.length,
    options: FENCE_LANGUAGES.map((label) => ({ label, type: "keyword" })),
    validFor: /^[\w-]*$/,
  };
}
