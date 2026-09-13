import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// 部品 (src/components) からサーバ専用の依存へ値で届く import を禁じるときの文言
const SERVER_ONLY_IMPORT_MESSAGE =
  "部品から prisma / sharp を値で import しない (クライアントの束に混ざって画面ごと落ちる)。型だけなら `import type` にする。docs/93-リファクタリング計画.md §2-2";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // 意図的に捨てる変数・引数は _ 始まりで表す (例: props から node を除外)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // 境界の機械検査 (docs/93-リファクタリング計画.md §2-2 手順 5)。
    //
    // server-only マーカーは next build で初めて落ちるので、書いた時点で気づける
    // よう lint でも止める。"use client" の無い部品も client 部品から import
    // されればクライアントの束に入る。prisma の型 (Item など) は import type
    // ならコンパイルで消えるので通す
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/db",
              message: SERVER_ONLY_IMPORT_MESSAGE,
              allowTypeImports: true,
            },
            {
              name: "sharp",
              message: SERVER_ONLY_IMPORT_MESSAGE,
              allowTypeImports: true,
            },
          ],
          patterns: [
            {
              group: ["@/generated/prisma", "@/generated/prisma/*"],
              message: SERVER_ONLY_IMPORT_MESSAGE,
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    // 回路図の描画スクリプトは Next のバンドルを通さず node が直接起動する
    // 素の CommonJS なので、require() を使う (ESM 化すると子プロセスとして
    // 動かなくなる)
    files: ["scripts/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 静的アセット。node_modules から複製した vendor の wasm グルー (.mjs) を
    // 含み (copyOnnxWasm / copyEmbeddingWasm など)、自分のコードではないので
    // lint 対象にしない
    "public/**",
  ]),
]);

export default eslintConfig;
