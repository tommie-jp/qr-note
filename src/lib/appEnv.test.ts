import { afterEach, describe, expect, test, vi } from "vitest";
import {
  basicAuthEnv,
  databaseUrlEnv,
  demoLoginHintEnv,
  isDemoMode,
  isNodeEnvProduction,
  isProductionEnv,
  pathEnv,
  qrBaseUrlEnv,
  qrGitDirEnv,
  rakutenBooksEnv,
  webauthnEnv,
  yahooShoppingAppIdEnv,
} from "./appEnv";

const original = process.env.APP_ENV;
const originalDemo = process.env.DEMO_MODE;

afterEach(() => {
  if (original === undefined) {
    delete process.env.APP_ENV;
  } else {
    process.env.APP_ENV = original;
  }
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE;
  } else {
    process.env.DEMO_MODE = originalDemo;
  }
});

// 判定を間違えると「本番なのにローカルの見た目」(実害なし) か
// 「ローカルなのに本番の見た目」(事故が再発する) のどちらかになる。
// 後者を絶対に起こさない = production を明示したときだけ true、が満たすべき性質。
describe("isProductionEnv", () => {
  test("APP_ENV=production を明示したときだけ本番とみなす", () => {
    // Arrange
    process.env.APP_ENV = "production";

    // Act & Assert
    expect(isProductionEnv()).toBe(true);
  });

  test("未設定なら本番ではない (設定漏れは警告が出る側へ倒す)", () => {
    // Arrange
    delete process.env.APP_ENV;

    // Act & Assert
    expect(isProductionEnv()).toBe(false);
  });

  test("空文字 (.env に `APP_ENV=` と書いた形) でも本番ではない", () => {
    // Arrange
    process.env.APP_ENV = "";

    // Act & Assert
    expect(isProductionEnv()).toBe(false);
  });

  test("production 以外の値は本番ではない", () => {
    // Arrange & Act & Assert
    for (const value of ["development", "prod", "Production", "staging"]) {
      process.env.APP_ENV = value;
      expect(isProductionEnv(), `APP_ENV=${value}`).toBe(false);
    }
  });
});

// isProductionEnv とは逆で、判定を間違えると「デモなのに保護が効かない」=
// 無防備な書き込み可サイトになる。DEMO_MODE=1 を明示したときだけ true が満たすべき性質。
describe("isDemoMode", () => {
  test("DEMO_MODE=1 を明示したときだけデモとみなす", () => {
    // Arrange
    process.env.DEMO_MODE = "1";

    // Act & Assert
    expect(isDemoMode()).toBe(true);
  });

  test("未設定ならデモではない", () => {
    // Arrange
    delete process.env.DEMO_MODE;

    // Act & Assert
    expect(isDemoMode()).toBe(false);
  });

  test("1 以外の値 (true/yes/空文字) はデモではない", () => {
    // Arrange & Act & Assert
    for (const value of ["", "true", "yes", "0", "on"]) {
      process.env.DEMO_MODE = value;
      expect(isDemoMode(), `DEMO_MODE=${JSON.stringify(value)}`).toBe(false);
    }
  });
});

describe("isNodeEnvProduction", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("NODE_ENV=production のときだけ true (APP_ENV には左右されない)", () => {
    // Arrange
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "");

    // Act & Assert
    expect(isNodeEnvProduction()).toBe(true);
  });

  test("development・test では false", () => {
    for (const value of ["development", "test"]) {
      vi.stubEnv("NODE_ENV", value);
      expect(isNodeEnvProduction(), `NODE_ENV=${value}`).toBe(false);
    }
  });
});

// サーバの設定値は生のまま返す (空文字を既定へ倒すのは使う側の仕事)。
// **呼んだ時点で読む**ことも性質の一部 — テストが env を差し替えて使う
describe("サーバの設定値", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const singles: [string, () => string | undefined][] = [
    ["DATABASE_URL", databaseUrlEnv],
    ["QR_BASE_URL", qrBaseUrlEnv],
    ["YAHOO_SHOPPING_APP_ID", yahooShoppingAppIdEnv],
    ["QR_GIT_DIR", qrGitDirEnv],
    ["PATH", pathEnv],
    ["DEMO_LOGIN_HINT", demoLoginHintEnv],
  ];

  test.each(singles)("%s は呼んだ時点の値をそのまま返す", (name, read) => {
    // Arrange
    vi.stubEnv(name, "first");
    const first = read();
    vi.stubEnv(name, "");

    // Act
    const second = read();

    // Assert
    expect(first).toBe("first");
    expect(second).toBe("");
  });

  test.each(singles)("%s が未設定なら undefined", (name, read) => {
    vi.stubEnv(name, undefined);
    expect(read()).toBeUndefined();
  });

  test("ログインの資格情報は 2 つまとめて返す", () => {
    // Arrange
    vi.stubEnv("BASIC_AUTH_USER", "tommie");
    vi.stubEnv("BASIC_AUTH_HASH_B64", undefined);

    // Act & Assert
    expect(basicAuthEnv()).toEqual({ user: "tommie", hashB64: undefined });
  });

  test("パスキーの rpID と origin を返す", () => {
    vi.stubEnv("WEBAUTHN_RP_ID", "qr.example.jp");
    vi.stubEnv("WEBAUTHN_ORIGIN", "");
    expect(webauthnEnv()).toEqual({ rpId: "qr.example.jp", origin: "" });
  });

  test("楽天ブックスの 3 つを返す", () => {
    vi.stubEnv("RAKUTEN_APP_ID", "id");
    vi.stubEnv("RAKUTEN_ACCESS_KEY", "key");
    vi.stubEnv("RAKUTEN_APP_ORIGIN", undefined);
    expect(rakutenBooksEnv()).toEqual({
      appId: "id",
      accessKey: "key",
      origin: undefined,
    });
  });
});
