// サーバー情報の「この接続」節 (docs/109-サーバー情報計画.md)。
//
// いま画面を開いている要求が、どの経路で届いたかを出す。本番は 2026-11-05 から
// tailnet の中からだけ開ける (41-QR-search/docs/30-Tailscale限定計画.md) ので、
// 「Tailscale 経由」と出るのが正。「インターネット (公開側)」と出たら nginx の
// 絞りが外れている。
//
// 送信元は nginx が付ける X-Real-IP を見る。nginx は proxy_set_header で
// $remote_addr に**上書き**するので、ブラウザが偽の値を送っても届かない。
// app は 127.0.0.1:3000 にしか束ねていないので、nginx を通らずには来られない。
// X-Forwarded-For は見ない (先頭はブラウザが書ける)。
import { isIP } from 'node:net'
import type { InfoSection } from './types'

export const REAL_IP_HEADER = 'x-real-ip'

export type ConnectionRoute = 'tailscale' | 'host' | 'lan' | 'public' | 'unknown'

const ROUTE_LABEL: Readonly<Record<ConnectionRoute, string>> = {
  tailscale: 'Tailscale 経由',
  host: 'サーバ自身 (127.0.0.1)',
  lan: 'LAN (プライベートアドレス)',
  public: 'インターネット (公開側)',
  unknown: '不明 (nginx を通っていない)',
}

// 1 行に収まらない値は表示しない (ヘッダは外から来る値。画面を崩させない)
const MAX_SHOWN_LENGTH = 100
const NONE = 'なし'
const UNREADABLE = '(読めない値)'

// IPv4 射影 (::ffff:100.64.0.1) は IPv4 として見る
function unmapIpv4(address: string): string {
  const lower = address.toLowerCase()
  return lower.startsWith('::ffff:') && isIP(lower.slice(7)) === 4 ? lower.slice(7) : lower
}

function classifyIpv4(address: string): ConnectionRoute {
  const [a, b] = address.split('.').map(Number)
  // Tailscale は CGNAT の範囲 100.64.0.0/10 (100.64〜100.127) を配る
  if (a === 100 && b >= 64 && b <= 127) return 'tailscale'
  if (a === 127) return 'host'
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'lan'
  return 'public'
}

function classifyIpv6(address: string): ConnectionRoute {
  // Tailscale の IPv6 は fd7a:115c:a1e0::/48
  if (address.startsWith('fd7a:115c:a1e0:')) return 'tailscale'
  if (address === '::1') return 'host'
  return 'public'
}

export function classifyClientAddress(raw: string | null): ConnectionRoute {
  const address = unmapIpv4((raw ?? '').trim())
  switch (isIP(address)) {
    case 4:
      return classifyIpv4(address)
    case 6:
      return classifyIpv6(address)
    default:
      return 'unknown'
  }
}

function shown(value: string | null): string {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return NONE
  if (trimmed.length > MAX_SHOWN_LENGTH) return UNREADABLE
  return trimmed
}

function shownAddress(raw: string | null): string {
  const value = shown(raw)
  if (value === NONE) return NONE
  return isIP(unmapIpv4(value)) === 0 ? UNREADABLE : value
}

export function connectionSection(headers: Headers): InfoSection {
  const realIp = headers.get(REAL_IP_HEADER)
  return {
    id: 'connection',
    title: 'この接続',
    result: {
      kind: 'ok',
      rows: [
        { label: '経路', value: ROUTE_LABEL[classifyClientAddress(realIp)] },
        { label: '送信元', value: shownAddress(realIp) },
        { label: 'ホスト名', value: shown(headers.get('host')) },
      ],
    },
  }
}
