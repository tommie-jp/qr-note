import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { RecordAccess } from './RecordAccess'

// **このファイルの主眼** (docs/37-アクセス順計画.md §3)。
//
// 一覧の <Link> は Next.js が先読み (prefetch) する。先読みで走るのは
// サーバ側の描画だけなので、「サーバ描画では記録を呼ばない」ことが
// そのまま「一覧に並んだだけでは並びが動かない」の保証になる。
//
// 逆に、うっかりサーバコンポーネントで記録するように書き換えると、
// 検索結果の全ノートがアクセス順の先頭に来る。ここで気づけるようにしておく。
test('サーバ描画では記録を呼ばない (先読みで誤発火しない)', () => {
  const action = vi.fn()
  renderToStaticMarkup(<RecordAccess itemNo="1042" action={action} />)
  expect(action).not.toHaveBeenCalled()
})

test('何も描画しない (画面の見た目に影響しない)', () => {
  const action = vi.fn()
  const html = renderToStaticMarkup(
    <RecordAccess itemNo="1042" action={action} />,
  )
  expect(html).toBe('')
})
