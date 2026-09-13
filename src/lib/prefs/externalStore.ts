// React の外に正本を置く状態の購読 (docs/93-リファクタリング計画.md §3-1)。
//
// useSyncExternalStore に渡す subscribe / getSnapshot の組を、モジュール変数の
// Set と通知ループで手書きしていた (secretSession・notePagerPref・erudaConsole・
// offline/location の 4 本)。形は同じなので、ここに 1 本だけ置く。
//
// 2 段に分けてある:
//   createNotifier      … 購読者の集合と通知だけ。値の正本が別の場所にある
//                         (sessionStorage・window.location) ときに使う
//   createExternalStore … 値もここに持つ。get は set されるまで同じ値を返し
//                         続けるので、useSyncExternalStore が「変わった」と見て
//                         描画し続けることがない

import { useSyncExternalStore } from 'react'

export interface Notifier {
  // 解除する関数を返す (useSyncExternalStore の subscribe の形)
  subscribe(listener: () => void): () => void
  notify(): void
}

export function createNotifier(): Notifier {
  const listeners = new Set<() => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    notify() {
      for (const listener of listeners) {
        listener()
      }
    },
  }
}

export interface ExternalStoreOptions<T> {
  // 最初に読まれたときに 1 回だけ呼ぶ。localStorage のような端末の値を
  // モジュールの読み込み時 (サーバ描画でも起きる) に触らないため
  readonly initial: () => T
  // サーバ描画とハイドレーションで使う値。端末にしかない状態はブラウザでしか
  // 読めないので、サーバが描いた HTML と食い違わないよう既定に固定する
  // (React がハイドレーションの後に get で読み直す)
  readonly serverSnapshot: T
}

export interface ExternalStore<T> {
  // getSnapshot。set されるまで同じ値 (同じ参照) を返す
  get(): T
  // 値を差し替えて購読者へ知らせる。**同じ値でも知らせる** — React 以外の
  // 購読者 (施錠されたら復号済みデータを捨てる、など) は呼ばれた回数で動く
  set(value: T): void
  subscribe(listener: () => void): () => void
  // 値を購読する React フック。サーバ描画では serverSnapshot
  useStore(): T
}

export function createExternalStore<T>({
  initial,
  serverSnapshot,
}: ExternalStoreOptions<T>): ExternalStore<T> {
  const notifier = createNotifier()
  // 箱に入れて「まだ読んでいない」と「値が null」を区別する
  let current: { readonly value: T } | null = null

  function get(): T {
    if (current === null) {
      current = { value: initial() }
    }
    return current.value
  }

  function set(value: T): void {
    current = { value }
    notifier.notify()
  }

  function getServerSnapshot(): T {
    return serverSnapshot
  }

  function useStore(): T {
    return useSyncExternalStore(notifier.subscribe, get, getServerSnapshot)
  }

  return { get, set, subscribe: notifier.subscribe, useStore }
}
