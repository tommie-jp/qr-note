// next/dynamic の差し替え (docs/96-シークレット・お絵かきのテスト計画.md §4-1)。
//
// SecretBlock・SecretTools (と編集画面の DrawModal など) は重い部品を
// `dynamic(() => import('…'), { ssr: false })` で開くまで読まない。
// renderToStaticMarkup は非同期の loader を待てないので、本物のまま描くと
// loading (= null) しか見えず、「その席に何が置かれるか」をテストで確かめられない。
//
// テストからは `vi.mock('next/dynamic', () => import('@/test/dynamicStub'))` で
// 向ける。loader は呼ばず、どの部品の席かを data 属性で示す span を描く
// (中身の描画はその部品自身のテストが持つ。draw 側のテストとも共有する)。
//
// 席の名前は loader の中の import 先のファイル名 (拡張子なし)。vitest は
// `import('./SecretDialog')` を
// `__vite_ssr_dynamic_import__("/src/…/SecretDialog.tsx")` に書き換えるので、
// 書き方 (`./X`・`@/…/X`・書き換え後の絶対パス) に左右されないファイル名だけを使う

import { createElement, type ComponentType } from 'react'

export const DYNAMIC_STUB_ATTRIBUTE = 'data-dynamic-stub'

// loader の関数の中身から import 先を読み取る。関数でない loader
// (Promise を直接渡す書き方) はこのリポジトリに無いので 'unknown' に落とす
export function dynamicStubName(loader: unknown): string {
  if (typeof loader !== 'function') {
    return 'unknown'
  }
  const target = /["']([^"']+)["']/.exec(loader.toString())?.[1]
  if (target === undefined) {
    return 'unknown'
  }
  const base = target.slice(target.lastIndexOf('/') + 1)
  return base.replace(/\.[jt]sx?$/, '')
}

export default function dynamicStub(
  loader: unknown,
): ComponentType<Record<string, unknown>> {
  const name = dynamicStubName(loader)
  function DynamicStub() {
    return createElement('span', { [DYNAMIC_STUB_ATTRIBUTE]: name })
  }
  DynamicStub.displayName = `DynamicStub(${name})`
  return DynamicStub
}
