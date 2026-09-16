import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import dynamicStub, { dynamicStubName } from './dynamicStub'

// loader は呼ばない (呼ぶと本物の部品が読まれ、SSR で待てない)。
// 席の名前だけを import 先から取る
test('import 先のファイル名で席を描く', () => {
  const Stub = dynamicStub(() => import('./emptyModule'))

  const html = renderToStaticMarkup(<Stub />)

  expect(html).toBe('<span data-dynamic-stub="emptyModule"></span>')
})

test('then で名前付き export を選ぶ書き方でも import 先を読む', () => {
  const name = dynamicStubName(() =>
    import('./fakeSpeech').then((m) => m.installSpeech),
  )

  expect(name).toBe('fakeSpeech')
})

test('関数でない loader は unknown', () => {
  expect(dynamicStubName(Promise.resolve({ default: () => null }))).toBe(
    'unknown',
  )
})
