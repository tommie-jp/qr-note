import { isNodeEnvProduction } from '@/lib/appEnv'

// 見た目の好みを持つ cookie の作法 (ペイン構成・表示モード・並び順)。
// どれも同じで、違うのは寿命だけ。サーバアクション (app/actions/prefs.ts) と
// 設定の口 (api/settings/pane-mode) の両方が書くので、ここに 1 本だけ置く。
// secure は呼ぶたびに読む (関数にしてあるのはそのため)
export function preferenceCookie(maxAge: number) {
  return {
    // サーバしか読まない (描画前に読めることがこの方式の要)。
    // クライアント JS へ見せる理由がないので閉じておく
    httpOnly: true,
    // HTTPS でだけ送る。ローカル開発は http なので付けない
    // (付けるとローカルで cookie が保存されず、切り替えが効かなくなる)
    secure: isNodeEnvProduction(),
    // 他サイトからの遷移で好みが飛ばない程度に緩く。strict にすると
    // 外部リンクから戻ったときだけ既定に見え、消えたと誤解される
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}
