// 端末側の action から画面を動かすための窓口 (docs/123 §2-1)。
//
// Server Action は redirect() で画面を移せたが、端末の関数はフックを呼べない
// (form の action に渡す関数は部品の外で定義する)。そこで、根の部品
// (RouterBridge) が useRouter の値をここへ登録し、action はそれを使う。
// 登録前 (読み込み直後の一瞬) は素の画面遷移へ倒す
import 'client-only'
import { clientNoteHref, clientNotePaneActive, openClientNote, showingClientNote } from './clientNoteNav'

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
  // 検索画面の中でノートへ移るとき (ペインの中で保存した後の ?saved= など) は
  // 端末で開く (docs/123 §12)。サーバへ行くと殻の往復を待つ
  const clientHref = clientNotePaneActive() ? clientNoteHref(href, location.origin) : null
  if (clientHref !== null) {
    openClientNote(clientHref, { replace })
    return
  }
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
  if (router !== null) {
    refreshRouter(router)
  }
}

// router.refresh() の代わり (docs/123 §12-3)。
//
// 端末で開いたノート (pushState) を出している間、Next の木は検索画面のまま
// URL だけが /item/<id> になっている。ここで refresh すると Next は
// /item/<id> の木を取り直し、検索画面ごと全画面のノートに置き換わる
// (今の URL への replace でも同じだった。手元の本番ビルドで確認)。
//
// そこでノートを閉じる (URL が /item を離れる) まで遅らせる。画面に出ている
// 物は困らない — 一覧・ノートは端末の控えから描き、表示モードとペイン構成は
// 送った先を store が持ち続ける (pendingViewMode・pendingPaneMode)。
// refresh が埋めるのはサーバが描く殻の cookie の値だけ
let deferred: AppRouterLike | null = null

export function refreshRouter(target: AppRouterLike): void {
  if (showingClientNote()) {
    deferred = target
    return
  }
  deferred = null
  target.refresh()
}

// 遅らせた refresh を流す。ClientNotePane が URL の変わるたびに呼ぶ
export function flushDeferredRefresh(): void {
  if (deferred === null || showingClientNote()) {
    return
  }
  const target = deferred
  deferred = null
  target.refresh()
}

// 検索画面を離れた (ClientNotePane が外れた)。行き先の画面はサーバが新しく
// 描くので、遅らせた refresh は要らない
export function dropDeferredRefresh(): void {
  deferred = null
}
