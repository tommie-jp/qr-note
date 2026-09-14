// パスキーの口の URL (docs/29-パスキー計画.md §6)。
//
// 画面 (fetch する側)、auth/publicPaths.ts (公開してよいものを決める側)、
// route handler (実体) の 3 か所が同じ文字列を要る。手で書き写すと、
// 直したつもりで片方が古いまま残る — 特に publicPaths とずれると
// 「ログインの口だけ 401 になる」という直しにくい壊れ方をする。

export const PASSKEY_REGISTER_OPTIONS_PATH = '/api/auth/passkey/register-options'
export const PASSKEY_REGISTER_VERIFY_PATH = '/api/auth/passkey/register-verify'
export const PASSKEY_LOGIN_OPTIONS_PATH = '/api/auth/passkey/login-options'
export const PASSKEY_LOGIN_VERIFY_PATH = '/api/auth/passkey/login-verify'
export const LOGOUT_PATH = '/api/auth/logout'
export const PASSKEYS_PATH = '/api/auth/passkeys'

// パスキーの管理画面
export const PASSKEY_SETTINGS_PATH = '/settings/passkeys'

// ログインしていない人が叩ける口。**この 2 つだけ**。
//
// 登録側 (register-*) を入れてはいけない。入れると誰でもパスキーを
// 足せてしまい、ログインの意味が無くなる (docs/29 §6)。
export const PUBLIC_AUTH_PATHS: readonly string[] = [
  PASSKEY_LOGIN_OPTIONS_PATH,
  PASSKEY_LOGIN_VERIFY_PATH,
]
