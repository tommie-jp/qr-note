"use client";

import { useEffect } from "react";
import { perfArrive } from "@/lib/logging/perfClient";
import type { PerfField } from "@/lib/logging/perfLine";

// サーバの段階をブラウザの計測へ渡す印 (docs/119-速度計測ログ計画.md §3-1)。
// 何も描かない。
//
// サーバが組んだ結果の中に置くので、**この effect が走る = React が差し替えを
// 描き終えた**時刻になる。計測の終わりの印とサーバの値の運び手を 1 つで兼ねる —
// サーバの行とブラウザの行を時刻で突き合わせる手間が消える。
//
// at … サーバが描いた時刻。打鍵ごとに届く新しい印を見分ける (同じ位置の
// 部品は作り直されず props だけが変わるので、effect を走らせ直す鍵になる)
export interface PerfMarksProps {
  kind: "検索" | "ノート";
  itemId?: string;
  at: number;
  fields: readonly PerfField[];
  server: string;
}

export function PerfMarks({ kind, itemId, at, fields, server }: PerfMarksProps) {
  useEffect(() => {
    perfArrive(kind, itemId, at, { fields, server });
  }, [kind, itemId, at, fields, server]);
  return null;
}
