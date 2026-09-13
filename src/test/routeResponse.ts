// route handler のテストで「応答の契約」を 1 つの値に畳む
// (docs/93-リファクタリング計画.md §3-3)。
//
// 状態コード・Content-Type・Cache-Control・本文をまとめて toEqual で比べる。
// 本文は **JSON の文字列 (キーの順まで)** で比べる — 封筒の組み立てを共通の
// 関数へ寄せても同じバイト列が出ていることを見るのが目的なので、
// toMatchObject のような緩い比較にはしない。
//
// Cache-Control は「付いていない」(null) も契約のうち。付け忘れの口を揃えるときは
// テストの期待値を書き換えることになり、変わったことが diff に残る

export interface ResponseContract {
  readonly status: number
  readonly contentType: string | null
  readonly cacheControl: string | null
  readonly body: string
}

export async function responseContract(response: Response): Promise<ResponseContract> {
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    cacheControl: response.headers.get('cache-control'),
    body: await response.text(),
  }
}

// 期待値を組み立てる側。キーの順は封筒の定義 ({ success, data, error }) どおり
export function jsonContract(
  status: number,
  body: unknown,
  cacheControl: string | null = 'no-store',
): ResponseContract {
  return {
    status,
    contentType: 'application/json',
    cacheControl,
    body: JSON.stringify(body),
  }
}

export function okEnvelope(data: unknown): { success: true; data: unknown; error: null } {
  return { success: true, data, error: null }
}

export function failEnvelope(error: string): { success: false; data: null; error: string } {
  return { success: false, data: null, error }
}
