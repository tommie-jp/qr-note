// サーバ起動時に一度だけ走る Next.js の作法 (instrumentation.ts)。
// console.warn / console.error を包んでリングバッファに控える
// (設計は docs/21-ログ表示計画.md。/logs ページが読む)。
//
// Node.js ランタイムのときだけ包む。register は全ランタイムで呼ばれるため、
// 条件を付けずに import すると Edge で落ちうる (公式の作法どおり)

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installConsoleCapture } = await import('./lib/logging/buffer')
    installConsoleCapture()
  }
}
