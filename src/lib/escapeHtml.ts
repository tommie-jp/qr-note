// HTML エスケープの単一ソース。
//
// dangerouslySetInnerHTML や手組みの HTML に文字列を埋める境界は
// 必ずここを通す (一覧の数式 mathText.ts、ログイン中止ページ
// cancelledPage.ts)。実装を 2 か所に持つと、将来の強化 (対象文字の追加や
// 置換方式の変更) が片方にだけ入って静かに食い違う。
const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char])
}
