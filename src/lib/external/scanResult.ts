import { buildSearchUrl } from '../search/url'
import { isValidItemNo } from '../validation'

// 読み取ったコードの遷移先を決める (設計は docs/09-スキャン計画.md §3)。
//
// 部品シールの QR だけ内部遷移し、それ以外 (外部 URL・ISBN・任意テキスト) は
// すべて検索に落とす。外部 URL を開かないのは意図的で、カメラにたまたま
// 写った QR で勝手に外部サイトへ飛ぶのを防ぐ。ISBN はメモ本文に書いておけば
// 全文検索で見つかるので、専用の扱いは要らない。
//
// itemHosts は「部品シールの URL だと認めるホスト」。呼び出し側から渡すのは、
// window に触れない純関数にしてテストできるようにするため。
//
// いま開いているホストだけで判定すると実機で困る。シールに焼かれているのは
// QR_BASE_URL (既定 qr.tommie.jp) 固定で、確認や作業のときは localhost や
// LAN の IP でアプリを開くため、両者は普通に食い違う。食い違うと黙って
// 検索に落ちて「0 件」になり、スキャナが壊れたようにしか見えない。
export function resolveScanPath(rawValue: string, itemHosts: string[]): string | null {
  const value = rawValue.trim()
  if (!value) {
    return null
  }

  const itemNo = itemNoFromUrl(value, itemHosts)
  if (itemNo) {
    return `/item/${itemNo}`
  }
  return buildSearchUrl(value, 1, 'updated')
}

// 部品シールの URL なら itemNo を返す。それ以外は null。
function itemNoFromUrl(value: string, itemHosts: string[]): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null // URL ではない (ISBN・任意テキスト)
  }

  // スキームは見ない。Ver1 のシールには http:// が焼き込まれており
  // (41-QR-search/docs/02-Ver1調査.md)、https 化後も貼り替えられないため。
  // origin 比較にすると http のシールが全部読めなくなる。
  //
  // 逆に hostname は完全一致で見る。endsWith だと
  // qr.tommie.jp.evil.com のようなホストを自サイトと誤認する。
  if (!itemHosts.includes(url.hostname)) {
    return null
  }

  const match = /^\/item\/([^/]+)\/?$/.exec(url.pathname)
  if (!match) {
    return null
  }

  // path をそのまま使わず、検証済みの itemNo から組み立て直す (呼び出し側)。
  // 読み取った文字列は他人が作った QR かもしれず、遷移先を仕込ませない
  let itemNo: string
  try {
    itemNo = decodeURIComponent(match[1])
  } catch {
    // 壊れた %シーケンス (例 /item/%E0%A4%A) は decodeURIComponent が
    // URIError を投げる。URL のパースは通ってしまうのでここで受ける。
    // 部品 URL として扱えないだけなので、検索に落として読み直させる
    return null
  }
  return isValidItemNo(itemNo) ? itemNo : null
}
