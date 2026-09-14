// ログインの入口と、ログイン後の戻り先 (docs/18-ログイン計画.md)。
//
// 戻り先 (next) はリンクを踏む人が自由に書ける値であり、外から来た入力として
// 扱う。素通しすると qr.tommie.jp のログインリンクが他所へ運ぶ踏み台になる。

// 401 を返して Basic 認証のダイアログを出させる口 (app/login/route.ts)
export const LOGIN_PATH = '/login'

// 未ログインで保護された画面を開いたときに proxy.ts が差し替える案内
export const LOGIN_REQUIRED_PATH = '/login-required'

const FALLBACK_PATH = '/'

// 制御文字 (改行・タブを含む) と空白と DEL。改行を通すと Location ヘッダを
// 割られてヘッダ注入の口になる。空白も弾く — 行き先に生の空白が要る場面はなく、
// 必要なら %20 で書けば通る
const UNSAFE_CHARS = /[\x00-\x20\x7f]/

// ログイン後の戻り先として使ってよい値だけを通す。だめなら '/'。
export function safeNextPath(next: string | null | undefined): string {
  if (!next) {
    return FALLBACK_PATH
  }

  if (UNSAFE_CHARS.test(next)) {
    return FALLBACK_PATH
  }

  // このサイトの中の絶対パスだけを通す。'https://…' や 'javascript:…' は
  // ここで落ちる
  if (!next.startsWith('/')) {
    return FALLBACK_PATH
  }

  // '//evil.example.com' はブラウザには 'https://evil.example.com' と同義。
  // '\' は '/' と同じに扱われるため '/\evil.example.com' も同じ行き先になる
  if (next.startsWith('//') || next.startsWith('/\\')) {
    return FALLBACK_PATH
  }

  // ログインの入口へ戻すと、ログインした先でまたログインを促すことになる
  if (isLoginPath(next)) {
    return FALLBACK_PATH
  }

  return next
}

function isLoginPath(next: string): boolean {
  const path = next.split(/[?#]/)[0]
  return path === LOGIN_PATH || path === LOGIN_REQUIRED_PATH
}

// ログインボタンの行き先。戻り先を先に検算しておくことで、
// 通らない値をわざわざ URL に載せない
export function loginHref(next: string): string {
  const safe = safeNextPath(next)
  if (safe === FALLBACK_PATH) {
    return LOGIN_PATH
  }
  // encodeURIComponent で丸ごと包む。生で載せると next の中の '&' や '='
  // がパラメータの区切りに見え、途中で切れる
  return `${LOGIN_PATH}?next=${encodeURIComponent(safe)}`
}
