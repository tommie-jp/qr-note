import { syntaxTree } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { suggestFenceLang } from "@/lib/fenceLanguages";

// フェンスの言語名 (CodeInfo) を走査し、circuitikz / mermaid / quiz の
// 打ち間違いっぽいものに「◯◯ の間違いでは?」と警告する。
//
// 補完だけでは入れ替わり誤字 (mermiad など) が候補ゼロになり無反応で確定して
// しまうため、確実に気付けるようにするのがこの linter の役目。対象を
// RENDERED_LANGS に絞るのは、それ以外は打ち間違えても「ただのコードブロック」に
// なるだけで実害が小さいから (rust などの正当な言語を叱らないためでもある)
export const fenceLanguageLinter = linter((view: EditorView): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (node.name !== "CodeInfo") {
        return;
      }
      const info = view.state.doc.sliceString(node.from, node.to);
      // 言語名は info string の先頭トークン (残りは属性などになり得る)
      const token = info.trim().split(/\s+/, 1)[0] ?? "";
      const suggestion = suggestFenceLang(token);
      if (!suggestion) {
        return;
      }
      diagnostics.push({
        from: node.from,
        to: node.from + token.length,
        severity: "warning",
        message: `フェンス言語 "${token}" は "${suggestion}" の間違いでは？`,
      });
    },
  });
  return diagnostics;
});
