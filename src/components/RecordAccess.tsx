"use client";

import { useEffect } from "react";
import type { recordAccessAction } from "@/app/actions";

// アクションは prop で受ける。ここから '@/app/actions' を import すると
// items/ → db.ts を巻き込み、クライアント束に DATABASE_URL を要求する
// モジュールが混ざる (ItemList / ViewModeToggle と同じ理由)
type RecordAccessActionType = typeof recordAccessAction;

interface RecordAccessProps {
  itemNo: string;
  action: RecordAccessActionType;
}

// ノートを開いたことを記録する (docs/37-アクセス順計画.md)。何も描画しない。
//
// **なぜサーバ側の描画で記録しないのか**が、このコンポーネントの存在理由。
// 一覧の <Link> は Next.js が先読み (prefetch) するので、ページの描画時に
// 記録すると「画面に並んだだけ」のノートが軒並み「見た」ことになり、
// アクセス順が検索結果の並びで埋まってしまう。prefetch はクライアントの
// 効果を実行しないため、マウント後に呼べば誤発火しない
// (Next.js の 07-mutating-data.md も、閲覧数の更新にこの形を挙げている)。
//
// 記録は「そのうち反映されればよい」もの。await せず、失敗しても画面には
// 出さない — 並びが 1 回進まないだけで、ノートの表示を巻き添えにする
// 理由がない。サーバ側 (recordAccessAction) はログに残す。
//
// 連打・StrictMode の二重発火は DB 側の 1 分ガード (items/flags.ts の
// recordItemAccess) が吸収するので、ここでは重複呼び出しを気にしない。
export function RecordAccess({ itemNo, action }: RecordAccessProps) {
  useEffect(() => {
    void action(itemNo).catch((error: unknown) => {
      // 画面には出さない。ブラウザ側のログは DebugConsole から見える
      console.error("アクセス日時を記録できませんでした", error);
    });
  }, [itemNo, action]);

  return null;
}
