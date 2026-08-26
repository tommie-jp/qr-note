import { afterEach, describe, expect, test } from "vitest";
import robots from "./robots";

const originalDemo = process.env.DEMO_MODE;

afterEach(() => {
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE;
  } else {
    process.env.DEMO_MODE = originalDemo;
  }
});

// docs/39-デモ公開計画.md §3。単一の rules オブジェクトを返す前提で読む
function singleRule(result: ReturnType<typeof robots>) {
  const { rules } = result;
  if (Array.isArray(rules)) {
    throw new Error("rules は単一オブジェクトの想定");
  }
  return rules;
}

// デモは UA ごとに規則を分けるので配列で返る (docs/89-OGP計画.md §5)
function ruleFor(result: ReturnType<typeof robots>, userAgent: string) {
  const { rules } = result;
  if (!Array.isArray(rules)) {
    throw new Error("rules は配列の想定");
  }
  const rule = rules.find((r) => r.userAgent === userAgent);
  if (rule === undefined) {
    throw new Error(`${userAgent} の規則が無い`);
  }
  return rule;
}

describe("robots", () => {
  // カード生成のクローラーだけ通す (docs/89-OGP計画.md §5)。X に貼ったとき
  // サムネを出すため。検索エンジンのインデックスとは別物なので、
  // guest が上げた中身は下の disallow が引き続き守る
  test.each(["Twitterbot", "facebookexternalhit"])(
    "デモは %s (カード生成) を allow する",
    (userAgent) => {
      process.env.DEMO_MODE = "1";
      const rule = ruleFor(robots(), userAgent);
      expect(rule.allow).toBe("/");
      expect(rule.disallow).toBeUndefined();
    },
  );

  // RFC 9309: クローラーは自分に最も特化した UA グループだけに従うので、
  // 検索エンジンはここに落ちる。guest コンテンツの保護はこの 1 行が担う
  test("デモはそれ以外の全 UA を disallow する", () => {
    process.env.DEMO_MODE = "1";
    const rule = ruleFor(robots(), "*");
    expect(rule.disallow).toBe("/");
    expect(rule.allow).toBeUndefined();
  });

  // 並び順にも意味がある。`*` を先に書くと、group を上から読む実装
  // (robots.txt の解釈はクローラー任せ) で意図がぶれる
  test("デモは許可を先に、包括的な disallow を最後に置く", () => {
    process.env.DEMO_MODE = "1";
    const { rules } = robots();
    if (!Array.isArray(rules)) {
      throw new Error("rules は配列の想定");
    }
    expect(rules.at(-1)?.userAgent).toBe("*");
  });

  test("本番/ローカルは全許可 (crawl を止めると noindex が読まれない)", () => {
    delete process.env.DEMO_MODE;
    const rule = singleRule(robots());
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toBeUndefined();
  });
});
