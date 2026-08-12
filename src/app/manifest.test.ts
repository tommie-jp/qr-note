import { afterEach, describe, expect, test } from "vitest";
import manifest from "./manifest";

const originalAppEnv = process.env.APP_ENV;

afterEach(() => {
  if (originalAppEnv === undefined) {
    delete process.env.APP_ENV;
  } else {
    process.env.APP_ENV = originalAppEnv;
  }
});

// manifest の中身をそのまま写経しても「変えたら落ちる」だけのテストにしかならないので、
// 壊れると PWA として成立しなくなる条件だけを検査する。
// 逆プロキシ側の認証除外 (これが無いと manifest 自体が 401 になる) は
// vitest では見られないため、Caddyfile / vps2 の nginx を直に確認すること。
describe("PWA manifest", () => {
  test("Chrome がインストール可能と判定する 192/512 の PNG アイコンを両方持つ", () => {
    // Arrange
    const icons = manifest().icons ?? [];

    // Act
    const sizes = icons
      .filter((icon) => icon.purpose === "any" && icon.type === "image/png")
      .map((icon) => icon.sizes);

    // Assert
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  test("maskable アイコンを any とは別のファイルで持つ", () => {
    // Arrange
    const icons = manifest().icons ?? [];

    // Act
    const maskable = icons.filter((icon) => icon.purpose === "maskable");
    const any = icons.filter((icon) => icon.purpose === "any");

    // Assert
    expect(maskable).toHaveLength(1);
    // 同じ画像を兼用すると、切り抜きに耐える余白の分だけ通常表示で絵が小さくなる
    expect(any.map((icon) => icon.src)).not.toContain(maskable[0].src);
  });

  test("QR シールが指す /item/:itemNo が scope に入る", () => {
    // Arrange
    const { scope, start_url } = manifest();

    // Act & Assert
    // scope から外れると Android の WebAPK がその URL を捕まえず、
    // シールを読んでもブラウザで開いてしまう
    expect("/item/1003".startsWith(scope ?? "")).toBe(true);
    expect(start_url?.startsWith(scope ?? "")).toBe(true);
  });

  test("ブラウザ UI なしの standalone で起動する", () => {
    // Arrange & Act
    const { display } = manifest();

    // Assert
    expect(display).toBe("standalone");
  });

  test("ホーム画面に出す名前が空でない", () => {
    // Arrange & Act
    const { name, short_name } = manifest();

    // Assert
    expect(name).toBeTruthy();
    // short_name はランチャーのラベルに使われ、長いと省略される
    expect(short_name?.length).toBeGreaterThan(0);
    expect(short_name?.length).toBeLessThanOrEqual(12);
  });

  // standalone はブラウザの URL バーが無く、本番と見分ける手がかりが
  // ホーム画面の名前・起動時のスプラッシュ・ステータスバーの帯しかない
  describe("非本番の見分け", () => {
    test("本番は素の名前と白系の色", () => {
      // Arrange
      process.env.APP_ENV = "production";

      // Act
      const { name, short_name, theme_color, background_color } = manifest();

      // Assert
      expect(name).toBe("QR Note");
      expect(short_name).toBe("QR Note");
      expect(theme_color).toBe("#ffffff");
      expect(background_color).toBe("#f9fafb");
    });

    test("非本番は名前に LOCAL が入りピンクになる", () => {
      // Arrange
      delete process.env.APP_ENV;

      // Act
      const { name, short_name, theme_color, background_color } = manifest();

      // Assert
      expect(name).toContain("LOCAL");
      expect(short_name).toContain("LOCAL");
      // ランチャーのラベルに収まること (省略されると LOCAL が消えかねない)
      expect(short_name?.length).toBeLessThanOrEqual(12);
      expect(theme_color).toBe("#fce7f3");
      expect(background_color).toBe("#fdf2f8");
    });
  });
});
