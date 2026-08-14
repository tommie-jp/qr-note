"use client";

import { Suspense, use } from "react";
import type { CircuitResult, PendingCircuit } from "@/lib/circuitCache";
import { ERROR_SOURCE_CLASS } from "./ui";

interface CircuitDiagramProps {
  result: PendingCircuit;
  // エラー時に「何を書いたか」を出すための元ソース
  code: string;
}

// ```circuitikz フェンスの描画結果を表示する
// (docs/85-回路図表示待ち計画.md §3)。
//
// 描くのはサーバーの仕事のままだが、**描き上がるのを待ってから本文を出すのは
// やめた。** TeX は 1 枚 1〜3 秒かかり、待つ作りだとノートまるごと — 見出しも
// 問題文も — が白いまま止まる。ここは描画中の約束も受け取れるようにし、
// 待たせるのを図の場所 1 つに閉じ込める。
//
// use() のために "use client" が要る。オフラインの画面 (OfflineNote) は
// 描画済みの結果を同期で渡すので、そちらは待たずにそのまま出る
export function CircuitDiagram({ result, code }: CircuitDiagramProps) {
  return (
    <Suspense fallback={<CircuitPending />}>
      <SettledCircuit result={result} code={code} />
    </Suspense>
  );
}

// 描き上がるまでの場所取り。
//
// **高さを持たせる**のが要点 — 潰れた枠から図に差し替わると、その下を
// 読んでいた行が飛ぶ。図の実寸はまちまちなので合わせ切れないが、
// 何も無い 0px よりはずれが小さい。
//
// 「準備中」と言い切る (「読み込み中」ではない)。待たせているのは通信では
// なくサーバー側の描画で、電波の悪い所で粘っているわけではないため
function CircuitPending() {
  return (
    <div
      className="circuit-diagram flex min-h-28 items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50"
      role="status"
    >
      <span className="animate-pulse text-gray-500">回路図を準備中…</span>
    </div>
  );
}

// 約束かどうか。instanceof Promise で見ないのは、React が受け取るのが
// 素の Promise とは限らない (thenable) ため
function isPending(value: PendingCircuit): value is Promise<CircuitResult> {
  return typeof (value as Promise<CircuitResult>).then === "function";
}

function SettledCircuit({ result, code }: CircuitDiagramProps) {
  // use() は条件付きで呼んでよい唯一のフック。描画済みなら待たない
  const settled = isPending(result) ? use(result) : result;

  if ("error" in settled) {
    return (
      <div className="circuit-diagram rounded border border-red-300 bg-red-50 p-3">
        <p className="text-red-700">回路図のエラー: {settled.error}</p>
        {settled.texLog && (
          <pre className="mt-2 overflow-x-auto text-sm text-red-900">
            {settled.texLog}
          </pre>
        )}
        <pre className={ERROR_SOURCE_CLASS}>{code}</pre>
      </div>
    );
  }

  // TeX が生成し sanitizeCircuitSvg を通した SVG を埋め込む
  return (
    <div
      className="circuit-diagram"
      dangerouslySetInnerHTML={{ __html: settled.svg }}
    />
  );
}
