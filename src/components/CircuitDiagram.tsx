import type { CircuitResult } from "@/lib/circuitCache";
import { ERROR_SOURCE_CLASS } from "./ui";

interface CircuitDiagramProps {
  result: CircuitResult;
  // エラー時に「何を書いたか」を出すための元ソース
  code: string;
}

// ```circuitikz フェンスの描画結果を表示する。
// mermaid と違い描画はサーバー側で済んでいるので、ここは埋め込むだけ
// (クライアント側の JS もローディング状態も無い)
export function CircuitDiagram({ result, code }: CircuitDiagramProps) {
  if ("error" in result) {
    return (
      <div className="circuit-diagram rounded border border-red-300 bg-red-50 p-3">
        <p className="text-red-700">回路図のエラー: {result.error}</p>
        {result.texLog && (
          <pre className="mt-2 overflow-x-auto text-sm text-red-900">{result.texLog}</pre>
        )}
        <pre className={ERROR_SOURCE_CLASS}>{code}</pre>
      </div>
    );
  }

  // TeX が生成し sanitizeCircuitSvg を通した SVG を埋め込む
  return (
    <div
      className="circuit-diagram"
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
}
