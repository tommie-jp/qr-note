// 認証ダイアログを閉じた人に見せる画面 (docs/18-ログイン計画.md)。
//
// /login の 401 のボディは、普段は誰も見ない — 資格情報を入れれば 303 で
// 出ていくため。**見えるのはダイアログをキャンセルしたときだけ**で、
// そのときブラウザは 401 のボディをそのまま画面に出す。
// 生テキストだと戻り道の無い行き止まりに見えるので、ここで戻りリンクを出す。
//
// 自動で戻してはいけない。/login を読み直すことになり、認証ダイアログが
// また出て、また閉じて… という輪になる。戻るのは人が押したときだけ。
//
// Next.js のページとして書けないのは、この応答が 401 +
// WWW-Authenticate でなければならないため (route.ts のコメント参照)。
// ここだけ HTML を手で組む。

// next は safeNextPath を通っていて出どころは検算済みだが、'"' や '<' は
// 通り抜ける。属性の中に生で置くと属性を閉じられるので必ず包む
import { escapeHtml } from '@/lib/escapeHtml'

// 戻り先 (safeNextPath を通した値) を受け取り、401 のボディを組む
export function loginCancelledPage(next: string): string {
  const href = escapeHtml(next)

  return `<!DOCTYPE html>
<html lang="ja">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ログインを中止しました - QR Note</title>
<style>
body { margin: 0; padding: 2rem 1rem; font-family: system-ui, sans-serif; color: #1f2937; }
main { max-width: 32rem; margin: 0 auto; }
h1 { font-size: 1.125rem; margin: 0 0 .5rem; }
p { color: #4b5563; margin: 0 0 1.5rem; }
a { display: inline-flex; align-items: center; min-height: 2.75rem; padding: 0 1.5rem;
    border-radius: .25rem; background: #2563eb; color: #fff; text-decoration: none; font-weight: 500; }
</style>
<main>
<h1>ログインを中止しました</h1>
<p>ログインするには、もう一度やり直してください。</p>
<a href="${href}">戻る</a>
</main>
</html>
`
}
