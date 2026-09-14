import pkg from "../../../package.json";
import { BootTimingReport } from "@/components/diag/BootTimingReport";
import { ClientLogCapture } from "@/components/diag/ClientLogCapture";
import { DebugConsole } from "@/components/diag/DebugConsole";
import { OfflineSync } from "@/components/offline/OfflineSync";
import { RecordTagSearch } from "@/components/search/RecordTagSearch";

interface AppSideEffectsProps {
  // ログイン中のユーザー名。未ログインは null
  user: string | null;
  isDemo: boolean;
}

// root layout の body 末尾に置く、何も描かないクライアント部品の一群。
// 並びは元の layout のまま (effect は兄弟の順に走る)
export function AppSideEffects({ user, isDemo }: AppSideEffectsProps) {
  // サーバの受け口へ運ぶ 3 つ (ログ転送・オフライン同期・起動時間) を
  // 仕掛ける条件。ログイン中かつデモ以外 (理由はそれぞれの注)
  const reportsToServer = Boolean(user) && !isDemo;

  return (
    <>
      {/* どちらも何も描かない (docs/30-ブラウザログ計画.md)。
          転送はログイン中だけ仕掛ける — 受け口は 401 を返すので、
          未ログインで拾っても運べず、無駄な要求になる。
          eruda は逆に未ログインでも要る。「ログインできない不具合」の
          手掛かりはブラウザ側にしか無く、そのとき転送は使えない。
          デモでは /logs を閉じる (docs/38 §4) ので転送も仕掛けない
          (受け口も 403 を返す) */}
      {reportsToServer && <ClientLogCapture />}
      {/* タグを押した検索を履歴に残す。何も描かない。タグのリンクは一覧・
          画像タイル・詳細ページ・メモ本文の 4 か所にあるので、配って回らず
          ここで一括して受ける (docs/59-検索候補計画.md §2)。
          未ログインでは一覧も詳細も出ないので仕掛けない */}
      {user && <RecordTagSearch />}
      {/* オフライン用の持ち出し (docs/65-オフライン対応計画.md)。何も描かない。
          ログイン中だけ仕掛ける — 同期の口は 401 を返すので、未ログインで
          拾っても運べない (ClientLogCapture と同じ判断)。デモでも仕掛けない:
          消えるデータを端末へ溜める意味が無く、共有アカウントなので
          他人のノートが端末に残る (docs/38-デモモード計画.md §4) */}
      {reportsToServer && <OfflineSync version={pkg.version} />}
      {/* 起動にかかった時間の内訳を /logs へ送る (src/lib/logging/bootTiming.ts)。
          何も描かない。「デプロイ直後の起動だけ数十秒白い」の切り分け用で、
          原因が判ったら消してよい。仕掛ける条件は ClientLogCapture と同じ
          (転送の受け口が同じなので、ログイン中・デモ以外) */}
      {reportsToServer && <BootTimingReport version={pkg.version} />}
      {/* ?debug=1 の eruda (docs/30 §2)。ログイン状態に依らず置く
          (理由は components/diag/DebugConsole.tsx) */}
      <DebugConsole />
    </>
  );
}
