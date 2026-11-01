import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, test, vi } from 'vitest'

// 待ち行列の上限 (2026-11 の監査 M-13) と、子へ渡す環境変数の絞り。
// 子プロセスは差し替える — 返事をこちらが制御できる偽の子で、行列を好きな深さに溜める
const spawned: FakeChild[] = []

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly options: { env?: NodeJS.ProcessEnv; stdio?: unknown }
  readonly args: string[]
  constructor(args: string[], options: { env?: NodeJS.ProcessEnv }) {
    super()
    this.args = args
    this.options = options
  }
  send(): void {}
  kill(): void {}
  // テストが「描き上がった」ことにする
  finish(svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'): void {
    this.emit('message', { ok: true, svg })
  }
}

vi.mock('node:child_process', () => ({
  spawn: (_bin: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    const child = new FakeChild(args, options)
    spawned.push(child)
    return child
  },
}))

// SVG の検査は本物を通さない (描画の中身ではなく行列を見る)
vi.mock('./hash', () => ({ assertSafeCircuitSvg: (svg: string) => svg }))

const { CircuitQueueFullError, MAX_QUEUED_RENDERS, queuedRenderCount, renderCircuit, rendererEnv } =
  await import('./circuitikz')

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

afterEach(async () => {
  // 溜めた描画を全部片付けて、次のテストに行列を持ち越さない
  while (queuedRenderCount() > 0) {
    const child = spawned.shift()
    if (child === undefined) break
    child.finish()
    await settle()
  }
  spawned.length = 0
})

describe('render queue', () => {
  test('上限まで積めて、超えた分は TeX を起動せずに即座に断る', async () => {
    const pending = Array.from({ length: MAX_QUEUED_RENDERS }, (_, i) =>
      renderCircuit(`\\draw (0,0) -- (${i},0);`),
    )
    await settle()
    expect(queuedRenderCount()).toBe(MAX_QUEUED_RENDERS)
    // 直列なので動いている子は 1 つだけ
    expect(spawned).toHaveLength(1)

    await expect(renderCircuit('one too many')).rejects.toBeInstanceOf(CircuitQueueFullError)
    expect(spawned).toHaveLength(1)

    // 片付け: 先頭から順に描き上がらせる
    for (let i = 0; i < MAX_QUEUED_RENDERS; i++) {
      spawned[i].finish()
      await settle()
    }
    await Promise.all(pending)
    expect(queuedRenderCount()).toBe(0)
  })

  test('描き上がれば席が空き、また積める', async () => {
    const first = renderCircuit('a')
    await settle()
    spawned[0].finish()
    await first
    expect(queuedRenderCount()).toBe(0)
    const second = renderCircuit('b')
    await settle()
    spawned[1].finish()
    await second
  })
})

describe('child process hardening', () => {
  test('子には最小限の環境変数だけ渡し、ヒープの上限を付ける', async () => {
    const run = renderCircuit('c')
    await settle()
    const child = spawned[0]
    expect(child.args[0]).toMatch(/^--max-old-space-size=\d+$/)
    expect(Object.keys(child.options.env ?? {})).not.toContain('DATABASE_URL')
    child.finish()
    await run
  })

  test('rendererEnv は秘密を含む変数を落とす', () => {
    const env = rendererEnv({
      PATH: '/usr/bin',
      DATABASE_URL: 'postgresql://qr:secret@db/qr',
      BASIC_AUTH_HASH_B64: 'x',
      RAKUTEN_ACCESS_KEY: 'pk_x',
      NODE_ENV: 'production',
    })
    expect(env).toEqual({ PATH: '/usr/bin', NODE_ENV: 'production' })
  })
})
