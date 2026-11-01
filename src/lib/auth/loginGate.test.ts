import { describe, expect, test } from 'vitest'
import { createLoginGate, LoginBusyError } from './loginGate'

// 手で完了させられる仕事。門が「枠を取った/待たせた/断った」をこれで観測する
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// マイクロタスクを流す (then の連鎖が進むのを待つ)
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('createLoginGate', () => {
  test('runs up to maxConcurrent tasks at once and makes the rest wait', async () => {
    const gate = createLoginGate({ maxConcurrent: 1, maxWaiting: 2 })
    const first = deferred()
    const second = deferred()

    const firstRun = gate.run(() => first.promise)
    const secondRun = gate.run(() => second.promise)
    await settle()

    expect(gate.running).toBe(1)
    expect(gate.waiting).toBe(1)

    first.resolve()
    second.resolve()
    await Promise.all([firstRun, secondRun])
    expect(gate.running).toBe(0)
    expect(gate.waiting).toBe(0)
  })

  test('rejects with LoginBusyError once the waiting seats are full', async () => {
    const gate = createLoginGate({ maxConcurrent: 1, maxWaiting: 1 })
    const first = deferred()
    const second = deferred()

    const firstRun = gate.run(() => first.promise)
    const secondRun = gate.run(() => second.promise)
    // 3 本目は枠も待ち席も無い。bcrypt を回し始める前に断る
    await expect(gate.run(() => Promise.resolve('never'))).rejects.toBeInstanceOf(LoginBusyError)

    first.resolve()
    second.resolve()
    await Promise.all([firstRun, secondRun])
  })

  test('hands the slot to the next waiter when a task finishes', async () => {
    const gate = createLoginGate({ maxConcurrent: 1, maxWaiting: 2 })
    const first = deferred()
    let secondStarted = false

    const firstRun = gate.run(() => first.promise)
    const secondRun = gate.run(async () => {
      secondStarted = true
    })
    await settle()
    expect(secondStarted).toBe(false)

    first.resolve()
    await Promise.all([firstRun, secondRun])
    expect(secondStarted).toBe(true)
    expect(gate.running).toBe(0)
  })

  test('releases the slot when the task throws', async () => {
    const gate = createLoginGate({ maxConcurrent: 1, maxWaiting: 0 })

    await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')

    // 失敗で枠が漏れると、以後ずっと誰もログインできなくなる
    expect(gate.running).toBe(0)
    await expect(gate.run(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })

  test('returns the task result', async () => {
    const gate = createLoginGate({ maxConcurrent: 1, maxWaiting: 0 })
    await expect(gate.run(() => Promise.resolve('tommie'))).resolves.toBe('tommie')
  })
})
