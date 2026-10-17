import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import nextConfig from "../next.config";

// outputFileTracingIncludes のキーは picomatch のルート glob で、どのルートにも
// 当たらなくても**黙って何も同梱しない** (ビルドもエラーにならない)。
// docs/107 でルートを [itemNo] → [itemId] に改名したとき、回路図の描画
// スクリプトのキーだけ旧名のまま残っていた。ルートの改名に追随しているかを
// ここで見る。キーのエスケープ (`\\[`) を外して src/app の下に在るかを調べる
const APP_DIR = path.join(process.cwd(), "src", "app");

const includes = Object.entries(nextConfig.outputFileTracingIncludes ?? {});

test.each(includes)("同梱のキー %s は実在するルートを指す", (route) => {
  // Arrange
  const unescaped = route.replace(/\\(.)/g, "$1");

  // Act
  const exists = existsSync(path.join(APP_DIR, unescaped));

  // Assert
  expect(exists).toBe(true);
});

test.each(includes)("同梱のキー %s が指すファイルは在る", (_route, globs) => {
  for (const glob of globs) {
    // `./docs/**/*` のような glob は、ワイルドカードの手前のディレクトリを見る
    const fixed = glob.split("*")[0];
    expect(existsSync(path.join(process.cwd(), fixed))).toBe(true);
  }
});
