"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";

const BUTTON_CLASS = "rounded bg-blue-600 px-6 py-2 font-medium text-white";

// 配布をまたいだ操作か。画面を開いたあとに新しい版が配られると、画面が持っている
// Server Action の ID をサーバが知らず、Next.js がこの例外を投げる。
// 判定関数は instanceof なので、クラスが別の写しで読まれた場合に備えて名前でも見る
function isFromOlderDeployment(error: Error): boolean {
  return error.name === "UnrecognizedActionError" || unstable_isUnrecognizedActionError(error);
}

// 新しい版が配られたあとの操作。**再試行は出さない** — 同じ古い ID を
// 送り直すだけで必ずまた落ちる。読み込み直せば新しい版の画面になり、
// 書きかけのメモは下書き (lib/prefs/memoDraft.ts) から戻る
function NewDeploymentNotice() {
  return (
    <div className="space-y-4 py-8 text-center">
      <h1 className="text-xl font-bold">アプリが新しい版に更新されました</h1>
      <p className="text-gray-600">
        この画面は更新前の版のままなので、操作を受け付けられませんでした。
        ページを読み込み直してから、もう一度操作してください。
      </p>
      <p className="text-gray-600">
        書きかけのメモは下書きとして残っていて、読み込み直すと元に戻ります。
      </p>
      <button type="button" onClick={() => window.location.reload()} className={BUTTON_CLASS}>
        読み込み直す
      </button>
    </div>
  );
}

// サーバアクションや描画で予期しないエラーが起きたときの受け皿。
// これが無いと本番では Next.js の無装飾なエラー画面になる。
//
// **理由とエラー ID を出す。** 本番のサーバ側の例外は Next.js が中身を伏せて
// 定型文に差し替えるので、ここに出しても漏れない。ID (digest) はサーバログの
// 同じ例外に付いていて、ログを引く手がかりになる
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  if (isFromOlderDeployment(error)) {
    return <NewDeploymentNotice />;
  }
  return (
    <div className="space-y-4 py-8 text-center">
      <h1 className="text-xl font-bold">エラーが発生しました</h1>
      <p className="text-gray-600">
        操作をやり直してください。繰り返し発生する場合はサーバログを確認してください。
      </p>
      {error.message && (
        <p className="mx-auto max-w-prose break-words rounded bg-gray-100 px-3 py-2 text-left font-mono text-sm text-gray-700">
          {error.message}
        </p>
      )}
      {error.digest && <p className="text-sm text-gray-500">エラー ID: {error.digest}</p>}
      <button type="button" onClick={() => reset()} className={BUTTON_CLASS}>
        再試行
      </button>
    </div>
  );
}
