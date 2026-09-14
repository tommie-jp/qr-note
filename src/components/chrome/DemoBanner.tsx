interface DemoBannerProps {
  // ログイン案内 (docs/39-デモ公開計画.md §4)。デモスタックの env
  // DEMO_LOGIN_HINT の値。未設定 (null) なら案内行を出さない。
  loginHint?: string | null;
}

// デモインスタンスの常時バナー (docs/38-デモモード計画.md §6)。
//
// 目的は 2 つ — 悪用の抑止と、消えるデータであることの明示 (免責)。
// ピンク ([LOCAL] の印) と混同しないよう amber で塗る。layout が
// isDemoMode() のときだけ描く (このコンポーネント自身は env を見ない)。
//
// ログイン案内は loginHint で受ける (docs/39 §4)。Basic 認証のネイティブ
// ダイアログには説明を出せないため、押す前に見えるここに資格情報を書く。
// 値はデモスタックの .env にだけ置き、リポジトリには入れない。
export function DemoBanner({ loginHint }: DemoBannerProps = {}) {
  return (
    <div className="border-b border-amber-300 bg-amber-100 text-amber-900 print:hidden">
      <div className="mx-auto max-w-2xl px-safe py-2 text-sm landscape-phone:max-w-4xl">
        <span className="font-bold">デモ環境です。</span>{" "}
        保存したデータは定期的にすべて削除されます。個人情報や不適切なファイルは
        アップロードしないでください。
        {/* 書誌 (書名・著者) はキー不要なのでデモでも取れる
            (docs/45-デモ書誌開放計画.md)。無効なのは JAN 情報だけ — Yahoo の
            キーが本質的に要る (docs/39 §5)。スキャン時の個別メッセージ
            (MemoEditor の PrefillNotice) と対で、常設でも知らせておく */}
        <span className="mt-1 block text-amber-800">
          ※ JAN 情報の自動取得はデモでは無効です (書籍情報は取得できます)。
        </span>
        {loginHint ? (
          <span className="mt-1 block font-mono text-amber-800">{loginHint}</span>
        ) : null}
      </div>
    </div>
  );
}
