// フェンスごとの集計を「事前計算を渡す」形のマップにする骨格
// (進捗の表 matrixData.ts と健康グラフ healthData.ts が共有する)。
//
// MarkdownView は同期に描くので、非同期の集計はページ側でここを await して
// 済ませ、結果を prop で渡す。鍵はフェンスの中身 (trim 済み) で、
// 同じ内容のフェンスが 2 つあれば 1 回の集計を共有する。
//
// 取り出し (extractFences.ts) と分けてあるのは、こちらがセッションを掴むため。
// 取り出しは DB もセッションも無しでテストできる葉のままにしておく

import { requireUser } from '@/lib/auth/session'

// 1 つのフェンスが集計できなかったときの結果
export interface FenceError {
  readonly kind: 'error'
  readonly error: string
}

export interface FenceDataOptions<R> {
  // 本文から取り出したフェンスの中身 (重複なし・本文に出てくる順)
  readonly sources: readonly string[]
  // 1 つのメモで集計するフェンスの上限。超えたぶんは後ろから落とす
  readonly limit: number
  // 上限を超えたフェンスに出す文言
  readonly overLimitError: string
  // 認証を通った後に 1 回だけ呼ぶ。フェンスをまたいで使い回す控え
  // (ParseCache や同じ検索式のクエリ) はここで作り、返した関数で 1 つずつ集計する
  readonly prepare: () => (source: string) => Promise<R | FenceError>
}

// 本文中のフェンスをすべて集計してマップにする。
//
// **ログイン必須**。表やグラフの中身はそのノート 1 枚の外から作られるので、
// 公開ビューへ渡さないという実装時の判断だけに頼らず、ここで requireUser() を
// 通して落とす (docs/77-進捗マトリックス計画.md §6、docs/83-健康管理フェンス計画.md §8)。
// フェンスが 1 つも無い本文では requireUser() を呼ばずに空のマップを返す。
//
// 1 つ失敗しても他のフェンスと本文は出したいので、失敗はマップに畳んで返す
// (投げ返さない) のが呼び出し側の約束。ただし認証だけは畳まない — 静かに
// 空の表を出すより、落ちて気づけるほうがよい。
//
// マップへ入れる順は「上限超過のエラー → 集計した結果」
export async function buildFenceData<R>({
  sources,
  limit,
  overLimitError,
  prepare,
}: FenceDataOptions<R>): Promise<Map<string, R | FenceError>> {
  const results = new Map<string, R | FenceError>()
  if (sources.length === 0) {
    return results
  }

  await requireUser()

  for (const source of sources.slice(limit)) {
    results.set(source, { kind: 'error', error: overLimitError })
  }

  const build = prepare()
  const built = await Promise.all(
    sources
      .slice(0, limit)
      .map(async (source): Promise<[string, R | FenceError]> => [
        source,
        await build(source),
      ]),
  )
  for (const [source, result] of built) {
    results.set(source, result)
  }

  return results
}

// 同じ鍵の呼び出しは 1 回の Promise を共有する。**Promise を鍵に入れる**
// のが要点で、結果を入れる作りだと Promise.all で同時に走る 2 つが
// どちらもキャッシュを外し、同じクエリが 2 回飛ぶ
export function sharePending<T>(
  run: (key: string) => Promise<T>,
): (key: string) => Promise<T> {
  const pending = new Map<string, Promise<T>>()
  return (key) => {
    const existing = pending.get(key)
    if (existing !== undefined) {
      return existing
    }
    const started = run(key)
    pending.set(key, started)
    return started
  }
}
