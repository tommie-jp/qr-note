"use client";

import { useEffect, useId, useState } from "react";
import { mermaidRenderId, renderMermaidSvg } from "@/lib/mermaidRender";
import { ERROR_SOURCE_CLASS } from "./ui";

// 読み込み・初期化・描画は @/lib/mermaidRender に寄せた。編集画面の
// ライブプレビュー (docs/70 §7) も同じ図を描くため — initialize が
// 二重に走らないよう、出どころを 1 つにする

// 描画結果は「成功 (svg)」「失敗 (error)」「描画中 (null)」のいずれか 1 つ
type RenderState = { svg: string } | { error: string } | null;

interface MermaidDiagramProps {
  code: string;
}

// ```mermaid フェンスを図として描画する
export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const reactId = useId();
  const [state, setState] = useState<RenderState>(null);

  useEffect(() => {
    let cancelled = false;
    const renderId = mermaidRenderId(reactId);

    (async () => {
      try {
        const svg = await renderMermaidSvg(code, renderId);
        if (!cancelled) {
          setState({ svg });
        }
      } catch (e) {
        // 一時要素の掃除は renderMermaidSvg が済ませている
        if (!cancelled) {
          setState({ error: e instanceof Error ? e.message : String(e) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, reactId]);

  if (state && "error" in state) {
    return (
      <div className="mermaid-diagram rounded border border-red-300 bg-red-50 p-3">
        <p className="text-red-700">mermaid の構文エラー: {state.error}</p>
        <pre className={ERROR_SOURCE_CLASS}>{code}</pre>
      </div>
    );
  }

  if (!state) {
    return <div className="mermaid-diagram text-gray-500">図を描画中…</div>;
  }

  // mermaid が生成した SVG (securityLevel: strict でサニタイズ済み) を埋め込む
  return (
    <div
      className="mermaid-diagram"
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
