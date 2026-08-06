import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { isValidCommitOid, noteFilePath } from './notePath'

// ノート本文の git 履歴 (docs/57-ノートgit履歴計画.md)。
//
// DB (items.memo) が正本・作業コピーで、ここはコミット済みスナップショット
// の置き場に徹する。保存経路はこのモジュールを通らない — コミット・履歴・
// 復元のときだけ呼ばれる。
//
// リポジトリはインスタンス全体で 1 つ・非 bare。ノートは notes/<itemNo>.md。
// author を固定するのはシングルユーザーだから (複数ユーザー化するときに
// アプリのユーザー情報へ差し替える)。
const GIT_AUTHOR_NAME = 'qr-search'
const GIT_AUTHOR_EMAIL = 'qr-search@localhost'

export interface NoteCommit {
  oid: string
  // 差分表示の比較先。初コミット (親なし) は null
  parentOid: string | null
  // ISO 8601 (%aI)。画面は formatJstDateTime(new Date(date)) で整形する
  date: string
  message: string
}

// 置き場。本番はコンテナ内 /app/data/git-notes に named volume が当たる
// (compose.yaml)。開発は data/ (gitignore 済み) の下。テストは
// QR_GIT_DIR を一時ディレクトリへ向ける。
function repoDir(): string {
  return process.env.QR_GIT_DIR ?? join(process.cwd(), 'data', 'git-notes')
}

// 書き込みを 1 本に並べるプロセス内キュー (単一コンテナ・単一プロセス前提)。
// git は index.lock で自衛するが、衝突した側がエラーになるので、
// そもそもぶつけない。前のタスクの失敗は次へ引き継がない。
//
// **呼び出し側は必ず await すること。** queue 側が reject を先に「処理済み」に
// するため、fire-and-forget で呼ぶと失敗が unhandledRejection にすら出ない。
let queue: Promise<unknown> = Promise.resolve()

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

// 初期化済みディレクトリの控え (毎回 .git を stat しないため)。
// パスをキーにするのは、テストが QR_GIT_DIR を差し替えるため。
const ensuredDirs = new Set<string>()

// リポジトリを開く。無ければ作る (git init + 空の初期コミット)。
//
// 初期コミットを打っておくと HEAD が常に在り、「空リポジトリだけ log/show が
// 失敗する」という分岐が全呼び出しから消える。
//
// **リポジトリ判定は <dir>/.git の存在で見る**。rev-parse 系で判定してはいけない —
// 開発時の置き場 (qr-search/data/git-notes) は qr-search リポジトリの作業ツリーの
// 中にあり、「リポジトリ内か」を訊くと外側のリポジトリに当たってしまう。
// ノートのコミットがアプリのリポジトリへ混ざるのは最悪の壊れ方なので、
// 判定を曖昧にしない。
// git 子プロセスへ渡す環境は**最小の allowlist** (親の環境を引き継がない)。
//
// - GIT_DIR / GIT_WORK_TREE が紛れると操作が別のリポジトリへ向く。
//   GIT_EDITOR / PAGER の類は simple-git が安全弁 (unsafe plugin) で拒否する。
//   ブロックリストで削るより、要る物だけ渡す方が漏れがない。
// - HOME を渡さないので ~/.gitconfig も読まれない。開発マシンの alias や
//   core.hooksPath がノート履歴の挙動へ漏れず、コンテナ (グローバル設定なし)
//   と同じ条件で動く。identity はリポジトリのローカル設定が持つ (openRepo)。
// - LC_ALL=C はエラーメッセージをロケール非依存にしてログを読める形に揃える。
function gitEnv(): Record<string, string> {
  const env: Record<string, string> = { LC_ALL: 'C' }
  if (process.env.PATH !== undefined) {
    env.PATH = process.env.PATH
  }
  return env
}

async function openRepo(): Promise<{ git: SimpleGit; dir: string }> {
  const dir = repoDir()
  await mkdir(join(dir, 'notes'), { recursive: true })
  const git = simpleGit(dir).env(gitEnv())

  if (!ensuredDirs.has(dir)) {
    const hasGitDir = await access(join(dir, '.git')).then(
      () => true,
      () => false,
    )
    if (!hasGitDir) {
      await git.init()
      // コンテナには git のグローバル設定がないので、identity はローカル設定で持つ
      await git.addConfig('user.name', GIT_AUTHOR_NAME)
      await git.addConfig('user.email', GIT_AUTHOR_EMAIL)
      await git.commit('init', undefined, { '--allow-empty': null })
    }
    ensuredDirs.add(dir)
  }

  return { git, dir }
}

async function headOid(git: SimpleGit): Promise<string> {
  return (await git.revparse(['HEAD'])).trim()
}

// いまの本文を 1 版としてコミットする。本文が HEAD と同じなら null
// (履歴を空コミットで汚さない)。戻り値は新しいコミットの oid。
export async function commitNote(
  itemNo: string,
  memo: string,
  message: string,
): Promise<string | null> {
  const rel = noteFilePath(itemNo)
  return serialized(async () => {
    const { git, dir } = await openRepo()
    await writeFile(join(dir, rel), memo, 'utf8')
    const status = await git.raw(['status', '--porcelain', '--', rel])
    if (status.trim() === '') {
      return null
    }
    await git.add(['--', rel])
    // パス指定で「このノートの変化だけ」をコミットする。過去の失敗などで
    // 他のファイルが index に残っていても巻き込まない
    await git.commit(message, [rel])
    return headOid(git)
  })
}

// 永久削除の墓石コミット (docs/57 §4)。履歴に「この版で消えた」を残しつつ、
// 過去の版は読めるままにする。一度もコミットされていないノートは対象外
// (消す物がない)。すべて対象外なら null。
export async function removeNotes(
  itemNos: string[],
  message: string,
): Promise<string | null> {
  const rels = itemNos.map(noteFilePath)
  return serialized(async () => {
    const { git, dir } = await openRepo()
    const targets: string[] = []
    for (const rel of rels) {
      // 静かに飛ばしてよいのは ENOENT (一度もコミットされていない = 墓石不要)
      // だけ。EACCES や EIO まで「無い」に畳むと、呼び出し元 (tombstoneNotes)
      // の「失敗はログに残す」約束がここで黙って破られる
      const exists = await access(join(dir, rel)).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') {
            return false
          }
          throw error
        },
      )
      if (exists) {
        targets.push(rel)
      }
    }
    if (targets.length === 0) {
      return null
    }
    await git.rm(targets)
    await git.commit(message, targets)
    return headOid(git)
  })
}

// そのノートのコミット一覧 (新しい順)。一度もコミットされていなければ空。
export async function noteHistory(itemNo: string): Promise<NoteCommit[]> {
  const rel = noteFilePath(itemNo)
  return serialized(async () => {
    const { git } = await openRepo()
    const log = await git.log({
      file: rel,
      format: { oid: '%H', parents: '%P', date: '%aI', message: '%s' },
    })
    return log.all.map((entry) => ({
      oid: entry.oid,
      // %P は空白区切り。マージはまだ作らないが、作っても差分の比較先は
      // 第一親でよい (git log の既定と同じ見え方)
      parentOid: entry.parents === '' ? null : entry.parents.split(' ')[0],
      date: entry.date,
      message: entry.message,
    }))
  })
}

// その版の本文。その版にこのノートが存在しなければ null (削除後・登場前)。
// oid は noteHistory が返した 40 桁 hex だけを受ける。
export async function noteAtCommit(
  itemNo: string,
  oid: string,
): Promise<string | null> {
  if (!isValidCommitOid(oid)) {
    throw new Error(`コミット oid が不正です: ${oid}`)
  }
  return showNote(itemNo, oid)
}

// HEAD の本文 (未コミット差分の比較元)。コミットが 1 つもなければ null。
export async function noteAtHead(itemNo: string): Promise<string | null> {
  return showNote(itemNo, 'HEAD')
}

async function showNote(itemNo: string, rev: string): Promise<string | null> {
  const rel = noteFilePath(itemNo)
  return serialized(async () => {
    const { git } = await openRepo()
    // その版にファイルが在るかは ls-tree で見る。**空出力 (exit 0) = 無い**、
    // 非ゼロ終了 = リビジョン解決や読み取りの本物の失敗、と 1 コマンドで
    // 区別できる。cat-file -e や show の失敗を一律 null に畳んではいけない —
    // リポジトリ破損や I/O エラーまで「その版に存在しない (= 削除された)」
    // に化け、ログも残らず気づけなくなる。本物の失敗はそのまま投げて
    // error boundary / 呼び出し元に見せる
    const entry = await git.raw(['ls-tree', rev, '--', rel])
    if (entry.trim() === '') {
      return null
    }
    // show は blob をそのまま返す (末尾改行も込み)。復元の可逆性はここで決まる
    return git.show([`${rev}:${rel}`])
  })
}

// 既存の全ノートを 1 コミットで取り込む (scripts/backfillGitHistory.ts)。
// 冪等: 差がなければ何もコミットせず null。
export async function backfillNotes(
  notes: { itemNo: string; memo: string }[],
  message: string,
): Promise<string | null> {
  const entries = notes.map((note) => ({
    rel: noteFilePath(note.itemNo),
    memo: note.memo,
  }))
  return serialized(async () => {
    const { git, dir } = await openRepo()
    for (const { rel, memo } of entries) {
      await writeFile(join(dir, rel), memo, 'utf8')
    }
    await git.add(['--', 'notes'])
    const status = await git.raw(['status', '--porcelain', '--', 'notes'])
    if (status.trim() === '') {
      return null
    }
    await git.commit(message)
    return headOid(git)
  })
}

