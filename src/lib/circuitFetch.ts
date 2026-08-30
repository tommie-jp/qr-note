// 編集画面から回路図を描いてもらう (docs/70-編集ライブプレビュー計画.md §7)。
//
// 閲覧はページを描くサーバが済ませて props で渡すが、編集画面はクライアント
// なのでその結果を持っていない。/api/circuits に投げて SVG を受け取る。
//
// **同じソースは 1 回しか投げない。** 描画は 1 秒強かかる LaTeX の実行で、
// カーソルが出入りするたびに投げると待ち時間も負荷も積み上がる。結果は
// 中身をキーに覚え、進行中の約束も同じ表で共有する (同じ図が 2 つ並んでいても
// 要求は 1 本)。

import { CIRCUITIKZ_LANG, type CircuitLang, circuitKey } from './fenceLanguages'

// お知らせ (docs/91)。図は描けたが思ったとおりには出ていないもの。
// circuit フェンス (YAML) だけが持つ
export interface CircuitFetchNotice {
  readonly line: number | null
  readonly message: string
}

export type CircuitFetchResult =
  | { svg: string; notices?: readonly CircuitFetchNotice[] }
  | { error: string; notices?: readonly CircuitFetchNotice[] }

// 鍵 → 結果 (または進行中の約束)。上限を超えたら古いものから捨てる。
// **鍵に言語を混ぜる** — 同じ本文が 2 つの言語で書かれても別の図なので、
// 本文だけを鍵にすると片方の図がもう片方の場所に出る
const cache = new Map<string, Promise<CircuitFetchResult>>()
const CACHE_MAX = 30

export async function fetchCircuitSvg(
  source: string,
  lang: CircuitLang = CIRCUITIKZ_LANG,
): Promise<CircuitFetchResult> {
  const trimmed = source.trim()
  const key = circuitKey(lang, trimmed)
  const known = cache.get(key)
  if (known) {
    return known
  }

  const pending = requestCircuit(trimmed, lang, key)
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next()
    if (!oldest.done) {
      cache.delete(oldest.value)
    }
  }
  cache.set(key, pending)
  return pending
}

async function requestCircuit(
  source: string,
  lang: CircuitLang,
  key: string,
): Promise<CircuitFetchResult> {
  try {
    const res = await fetch('/api/circuits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, lang }),
    })
    if (!res.ok) {
      // 失敗は覚えない (通信の綾かもしれないので、次に開いたときは試し直す)
      cache.delete(key)
      return { error: `回路図を描画できませんでした (HTTP ${res.status})` }
    }
    const body: unknown = await res.json()
    const data = (
      body as { data?: { svg?: unknown; error?: unknown; notices?: unknown } }
    )?.data
    const notices = readNotices(data?.notices)
    if (typeof data?.svg === 'string') {
      return { svg: data.svg, notices }
    }
    // 書き間違いは 200 で理由が返る (route.ts の経緯)。これは覚えてよい —
    // 同じソースなら何度投げても同じ結果になる
    return {
      error: typeof data?.error === 'string' ? data.error : '回路図を描画できませんでした',
      notices,
    }
  } catch {
    cache.delete(key)
    return { error: '回路図を描画できませんでした (通信エラー)' }
  }
}

// 外から来た値なので形を確かめてから使う。読めない要素は落とす —
// お知らせは補助なので、1 件壊れていても図と他のお知らせは出す
function readNotices(value: unknown): readonly CircuitFetchNotice[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((row: unknown) => {
    const notice = row as { line?: unknown; message?: unknown }
    if (typeof notice?.message !== 'string') {
      return []
    }
    return [{
      line: typeof notice.line === 'number' ? notice.line : null,
      message: notice.message,
    }]
  })
}
