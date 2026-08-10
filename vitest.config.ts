import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
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
