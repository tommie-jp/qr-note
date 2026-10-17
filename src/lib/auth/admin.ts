// 管理者の判定 (docs/109-サーバー情報計画.md §2)。
//
// いまはシングルユーザだが、ログインしているユーザー名を "tommie" と
// コードで比べない — 本番の資格情報の名前がコードに焼き付くうえ、
// ローカル・デモ・将来の多人数 (41-QR-search/docs/23) で判定の出どころが
// 2 つに割れる。判定はここ 1 か所、正本は env ADMIN_USER。
//
// **ADMIN_USER が未設定 (または空) なら誰も管理者ではない。** 設定漏れが
// 「管理者の画面が開けない」(気づける) 側へ倒れ、「誰でも開ける」側へは
// 倒れない。空文字を弾くのは、.env に `ADMIN_USER=` と書いた形が
// 未ログイン ('' や null) と一致してしまわないため。
//
// server-only なのは、クライアント側から import されると env が undefined に
// 畳まれて黙って false になるため — ビルドで落ちるほうがよい
import 'server-only'
import { adminUserEnv } from '../appEnv'

export function isAdminUser(user: string | null): boolean {
  const admin = adminUserEnv()
  if (admin === undefined || admin === '') {
    return false
  }
  return user === admin
}
