// 端末側の action から画面を動かすための窓口 (docs/123 §2-1)。
//
// Server Action は redirect() で画面を移せたが、端末の関数はフックを呼べない
// (form の action に渡す関数は部品の外で定義する)。そこで、根の部品
// (RouterBridge) が useRouter の値をここへ登録し、action はそれを使う。
// 登録前 (読み込み直後の一瞬) は素の画面遷移へ倒す
import 'client-only'

export interface AppRouterLike {
  push(href: string, options?: { scroll?: boolean }): void
  replace(href: string, options?: { scroll?: boolean }): void
  refresh(): void
}

let router: AppRouterLike | null = null

export function registerRouter(next: AppRouterLike | null): void {
  router = next
}

export function navigate(href: string, { replace = false } = {}): void {
  if (router === null) {
    window.location.assign(href)
    return
  }
  if (replace) {
    router.replace(href, { scroll: false })
  } else {
    router.push(href)
  }
}

// サーバ描画のまま残る画面 (ゴミ箱・履歴・設定) を描き直させる
export function refreshServerView(): void {
  router?.refresh()
}
