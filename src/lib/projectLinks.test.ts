import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import pkg from "../../package.json";
import { THIRD_PARTY_LICENSES_PATH } from "./projectLinks";

// 第三者ライセンスの一覧は generate-license-file が .glf.json の設定で
// public/ へ書き出す。クレジットページのリンクと公開パスは
// THIRD_PARTY_LICENSES_PATH を見るので、書き出し先とずれると 404 になる
const glf = JSON.parse(readFileSync(join(process.cwd(), ".glf.json"), "utf8"));

test("一覧の書き出し先と、リンク・公開パスの URL が揃っている", () => {
  expect(glf.output).toBe(`./public${THIRD_PARTY_LICENSES_PATH}`);
});

// 本番のイメージは npm run build で作る。build から外れると、本番だけ
// 一覧が無い (リンクが 404) まま気づけない
test("本番ビルドが一覧を作り直す", () => {
  expect(pkg.scripts.build).toContain("npm run licenses");
  expect(pkg.scripts.licenses).toContain("generate-license-file");
});

// ci: true でないと、ライセンスが 2 つあるパッケージに当たったとき
// 対話で選ばせようとして、端末の無い Docker のビルドが止まる
test("対話なしで動く (Docker のビルドで止まらない)", () => {
  expect(glf.ci).toBe(true);
});
