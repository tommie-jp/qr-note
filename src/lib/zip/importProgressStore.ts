// 取り込みの進み具合の控え (docs/28-エクスポート計画.md §9)。
//
// **プロセス内の単一スロット**。本番は `node server.js` の 1 プロセスなので、
// モジュール変数で取り込み中の POST と進捗を覗く GET が同じ値を見られる。
// logBuffer.ts と同じ流儀で、実体は globalThis に置く (dev のホットリロードで
// このモジュールが再評価されても控えが消えない)。
//
// スロットが 1 つしかないのは進捗の都合ではない。**importZip は同時実行を
// 想定していない** — 採番も衝突判定も「いま DB にある番号」を見て決めるので、
// 2 本同時に走ると互いの結果を踏む。取れなかったら断る (409) のが正しい。
//
// 進捗が「見えない」ことは失敗にしない。控えが取れなくても取り込み自体は
// 進むべきで、画面の数字はあくまで補助 (だから更新側は例外を投げない)。

import type { ImportPhase, ImportProgress } from './importProgress'

// 応答が返る前に画面を閉じられる・プロセスが刺さるなどで、解放されないまま
// 残ることがある。**次の取り込みが永久に始められなくなる**ほうが困るので、
// これだけ経ったスロットは覗いたときに取り残しとみなして片付ける。
// 500MB を細い回線で送る時間 (実測 175MB で数秒〜数十秒) より十分に長く取る
const STALE_AFTER_MS = 30 * 60 * 1000

interface ProgressState extends ImportProgress {
  startedAt: number
  updatedAt: number
  // 世代。解放後に古い handle が触っても新しい取り込みを汚さないための印
  token: number
}

interface ProgressGlobal {
  current: ProgressState | null
  nextToken: number
}

const globalForProgress = globalThis as unknown as {
  qrNoteImportProgress?: ProgressGlobal
}

function state(): ProgressGlobal {
  globalForProgress.qrNoteImportProgress ??= { current: null, nextToken: 1 }
  return globalForProgress.qrNoteImportProgress
}

// 取り込みが既に走っているときに投げる。route が 409 に写す
export class ImportBusyError extends Error {
  constructor() {
    super('別の取り込みが進行中です。終わってからもう一度お試し下さい')
    this.name = 'ImportBusyError'
  }
}

// 進捗を更新する取っ手。**取り込み側はこれしか触らない** (スロットの
// 世代管理を呼ぶ側に配らないため)。
export interface ImportProgressHandle {
  addBytes: (bytes: number) => void
  startNotes: (total: number) => void
  noteDone: () => void
  finish: () => void
}

// 取り込みを始める。既に走っていれば ImportBusyError。
//
// now を引数で受けるのはテストのため (アプリからは省略して現在時刻)。
export function beginImport(
  totalBytes: number | null,
  now: number = Date.now(),
): ImportProgressHandle {
  const store = state()
  const running = activeState(store, now)
  // 終わった控え (done) は「見えているだけ」なので、次を止めない。
  // 応答が届くまでの一瞬だけ 100% を見せるために残してある
  if (running !== null && running.phase !== 'done') {
    throw new ImportBusyError()
  }

  const token = store.nextToken++
  store.current = {
    phase: 'receiving',
    totalBytes,
    readBytes: 0,
    notesTotal: 0,
    notesDone: 0,
    startedAt: now,
    updatedAt: now,
    token,
  }

  // 自分の世代のときだけ書き換える。解放済みの handle からの更新は捨てる
  const update = (change: (target: ProgressState) => void) => {
    const target = state().current
    if (target !== null && target.token === token) {
      change(target)
      target.updatedAt = Date.now()
    }
  }

  return {
    addBytes: (bytes) => update((target) => void (target.readBytes += bytes)),
    startNotes: (total) =>
      update((target) => {
        target.phase = 'notes'
        target.notesTotal = total
        target.notesDone = 0
      }),
    noteDone: () => update((target) => void (target.notesDone += 1)),
    finish: () => update((target) => void (target.phase = 'done' as ImportPhase)),
  }
}

// スロットを空ける。**必ず finally から呼ぶ** — 失敗して抜けた取り込みが
// スロットを握ったままだと、次が始められない
export function releaseImport(): void {
  state().current = null
}

// いま覗ける進捗。取り込んでいなければ null。
export function currentImport(now: number = Date.now()): ImportProgress | null {
  const active = activeState(state(), now)
  if (active === null) {
    return null
  }
  // 内部の印 (token / 時刻) は外に出さない。表示に要るのは進み具合だけ
  return {
    phase: active.phase,
    totalBytes: active.totalBytes,
    readBytes: active.readBytes,
    notesTotal: active.notesTotal,
    notesDone: active.notesDone,
  }
}

// 生きているスロットを返す。取り残し (長く音沙汰がない) はここで片付ける
function activeState(store: ProgressGlobal, now: number): ProgressState | null {
  const current = store.current
  if (current === null) {
    return null
  }
  if (now - current.updatedAt >= STALE_AFTER_MS) {
    store.current = null
    return null
  }
  return current
}
