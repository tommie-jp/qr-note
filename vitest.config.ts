import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import type { TestCase, TestModule, TestSuite } from 'vitest/node'
import tsconfigPaths from 'vite-tsconfig-paths'

// server-only / client-only の差し替え先 (中身の無い module)
const EMPTY_MODULE = fileURLToPath(new URL('./src/test/emptyModule.ts', import.meta.url))

// 失敗系のテストがわざと踏ませる console 出力 (docs/93-リファクタリング計画.md §2-1)。
// 実装側のログは本番で原因を切り分ける手がかりなので消さず、テストの出力からだけ外す。
// 「どのファイルの・どのテストが・どの文言で」の 3 つが揃ったものだけを落とし、
// それ以外 (新しく出始めた警告など) はすべて素通しする
const INTENTIONAL_LOGS: ReadonlyArray<{
  readonly file: string
  readonly test: string
  readonly prefix: string
}> = [
  {
    file: 'src/lib/zip/exportZip.test.ts',
    test: '参照先の添付が無くても書き出しは続く',
    prefix: '本文が参照する添付が見つかりません: ',
  },
  {
    file: 'src/lib/zip/exportZip.test.ts',
    test: '存在しない番号は飛ばして残りを書き出す',
    prefix: 'エクスポート対象のノートが見つかりません: ',
  },
  {
    file: 'src/lib/thumbnail.test.ts',
    test: 'アニメサムネが原寸より重くなるときは静止サムネにする',
    prefix: 'アニメのサムネイルが原寸より重いため静止にします (',
  },
  {
    file: 'src/lib/thumbnail.test.ts',
    test: '画像でないバイト列では null を返す (呼び出し側を失敗させない)',
    prefix: 'サムネイル生成に失敗しました (',
  },
  {
    file: 'src/lib/thumbnail.test.ts',
    test: '展開すると巨大になる画像は断る (解凍爆弾よけ)',
    prefix: 'サムネイル生成に失敗しました (',
  },
]

function isIntentionalLog(
  log: string,
  type: 'stdout' | 'stderr',
  entity: TestModule | TestSuite | TestCase | undefined,
): boolean {
  if (type !== 'stderr' || entity?.type !== 'test') return false
  const file = entity.module.relativeModuleId
  return INTENTIONAL_LOGS.some(
    (it) =>
      it.file === file && it.test === entity.name && log.startsWith(it.prefix),
  )
}

// @atomic-editor/editor の dist は `//# sourceMappingURL=*.js.map` を持つが、
// map が指す元の src/ を npm パッケージに同梱していない。下の inline で vite に
// 通すと、読み込むファイルごとに「Sourcemap ... points to missing source files」
// が 11 行出る。辿れない map は捨てて dist そのものを読ませる (実行する中身は同じ)。
// vitest は customLogger を自前で上書きするので、ロガー側では絞れない
const ATOMIC_EDITOR_DIST = /\/node_modules\/@atomic-editor\/editor\/dist\/[^/]+\.js$/
const SOURCE_MAPPING_URL = /\n\/\/# sourceMappingURL=\S+\s*$/

function dropAtomicEditorSourcemaps(): Plugin {
  return {
    name: 'drop-atomic-editor-sourcemaps',
    async load(id) {
      if (!ATOMIC_EDITOR_DIST.test(id)) return null
      const code = await readFile(id, 'utf-8')
      return { code: code.replace(SOURCE_MAPPING_URL, '\n'), map: null }
    },
  }
}

export default defineConfig({
  plugins: [tsconfigPaths(), dropAtomicEditorSourcemaps()],
  resolve: {
    alias: {
      // 境界のマーカー (docs/93-リファクタリング計画.md §2-2) は、Next の
      // ビルドでは層ごとに空か throw に振り分けられる。素の node 環境では
      // server-only が import しただけで throw し (react-server 条件でしか
      // 空にならない)、client-only は逆に react-server 条件で throw する。
      // テストは node 環境でサーバ専用 (prisma を掴む items.ts など) と
      // ブラウザ専用 (offline/* や prefs 系) の両方を直接読むので、解決条件に
      // 左右されないよう両方を空に向ける。誤った層からの import は
      // next build が落として検出する
      'server-only': EMPTY_MODULE,
      'client-only': EMPTY_MODULE,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    onConsoleLog: (log, type, entity) =>
      isIntentionalLog(log, type, entity) ? false : undefined,
    coverage: {
      // `npm run test:coverage` で取る。初回の数字は docs/93 §13
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/generated/**',
        'src/types/**',
        '**/__fixtures__/**',
        'src/test/**',
      ],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
    },
    server: {
      deps: {
        // @atomic-editor/editor (ライブプレビューの土台。
        // docs/70-編集ライブプレビュー計画.md) は dist の中で拡張子なしの
        // import (`./AtomicCodeMirrorEditor`) を使っている。バンドラ
        // (Turbopack) は解決できるが、Node の ESM 解決はできないため、
        // vitest が素で読むと「モジュールが見つからない」で落ちる。
        // vite に通して解決させる
        inline: ['@atomic-editor/editor'],
      },
    },
  },
})
