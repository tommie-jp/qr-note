import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// server-only / client-only の差し替え先 (中身の無い module)
const EMPTY_MODULE = fileURLToPath(new URL('./src/test/emptyModule.ts', import.meta.url))

export default defineConfig({
  plugins: [tsconfigPaths()],
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
