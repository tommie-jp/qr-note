// 第三者のページから動かされた呼び出しかどうか (設計は docs/18-ログイン計画.md §9)。
//
// このアプリの認証は Basic 認証で Cookie を使わない。つまり **SameSite が
// 効かない**。一度ログインしたブラウザは、どのページから出た要求であっても
// このオリジン宛なら認証情報を付け直す。悪意あるページに
//
//   <img src="https://qr.tommie.jp/api/books/9784873115658">
//
// と書いてあるだけで /api/books が本人として動き、外部 API のクォータを
// 使い、書影を DB に溜める (docs/19-書影取得計画.md)。
//
// アップロード (POST) は Origin で見分けている (uploads/request.ts) が、**GET の
// <img> は Origin を送らない** (単純リクエスト)。そこで Fetch Metadata を見る。
// Sec-Fetch-Site はブラウザが自分で付けるヘッダで、JS からは書き換えられない
// (Sec- で始まる名前は禁止ヘッダ名)。

// 自分のページの fetch (usePrefill) が送る値
const SAME_ORIGIN = 'same-origin'
// 人が URL を直接開いた (アドレス欄・ブックマーク) ときの値。
// 第三者のページからは起こせないので、手元の確認のために通す
const USER_INITIATED = 'none'

export function isCrossSiteRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site === null) {
    // ヘッダを送らない相手 (curl や古いブラウザ)。ここを閉じると
    // curl での確認ができなくなる。一方、防ぎたいのは「認証情報を持った
    // ブラウザが第三者のページに動かされること」で、**それができる
    // ブラウザは必ずこのヘッダを送る**。素通しでよい。
    //
    // 鍵を持っている相手が自分でヘッダを付けて叩くのは防げないが、それは
    // 本人であって、ここで防ぎたい相手ではない
    return false
  }
  // same-site (別のサブドメイン) も拒む。このアプリを呼ぶのは自分のページだけ
  return site !== SAME_ORIGIN && site !== USER_INITIATED
}
