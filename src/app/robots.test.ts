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

// デモも本番も UA ごとに規則を分けるので配列で返る
// (docs/89-OGP計画.md §5, docs/90-クローラ対策計画.md §3)。
//
// userAgent は 1 グループに複数書ける (Next.js は User-Agent 行を並べて出す)
// ので、文字列と配列のどちらでも引けるようにする
function ruleFor(result: ReturnType<typeof robots>, userAgent: string) {
  const { rules } = result;
  if (!Array.isArray(rules)) {
    throw new Error("rules は配列の想定");
  }
  const rule = rules.find((r) =>
    Array.isArray(r.userAgent) ? r.userAgent.includes(userAgent) : r.userAgent === userAgent,
  );
  if (rule === undefined) {
    throw new Error(`${userAgent} の規則が無い`);
  }
  return rule;
}

// 包括的な `*` は必ず最後。RFC 9309 ではクローラーは自分に最も特化した UA
// グループだけに従うが、group を上から読む実装もあるので意図をぶらさない
function lastRule(result: ReturnType<typeof robots>) {
  const { rules } = result;
  if (!Array.isArray(rules)) {
    throw new Error("rules は配列の想定");
  }
  return rules.at(-1);
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
    expect(lastRule(robots())?.userAgent).toBe("*");
  });

  // AI 学習用の収集を断る (docs/90-クローラ対策計画.md §3)。
  //
  // **noindex では止まらない**のがここの存在理由。ページ側の
  // `robots: { index: false }` は検索インデックスにしか効かず、学習用の
  // 収集は「読んで持ち帰る」だけなので素通りする。断るなら robots.txt しかない
  test.each(["GPTBot", "ClaudeBot", "CCBot", "Google-Extended", "Bytespider"])(
    "本番は %s (AI 学習収集) を disallow する",
    (userAgent) => {
      delete process.env.DEMO_MODE;
      const rule = ruleFor(robots(), userAgent);
      expect(rule.disallow).toBe("/");
      expect(rule.allow).toBeUndefined();
    },
  );

  // 検索エンジンは通したまま。crawl を止めると /item の noindex を
  // 読んでもらえず、かえってインデックスされる
  test("本番/ローカルはそれ以外の全 UA を allow する", () => {
    delete process.env.DEMO_MODE;
    const rule = ruleFor(robots(), "*");
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toBeUndefined();
  });

  // 検索用の Googlebot まで巻き込むと noindex が読まれなくなる。
  // Google-Extended (学習用の指示専用トークン) と混同しないこと
  test("本番は検索用の Googlebot を disallow しない", () => {
    delete process.env.DEMO_MODE;
    const { rules } = robots();
    if (!Array.isArray(rules)) {
      throw new Error("rules は配列の想定");
    }
    const disallowed = rules
      .filter((r) => r.disallow !== undefined)
      .flatMap((r) => (Array.isArray(r.userAgent) ? r.userAgent : [r.userAgent]));
    expect(disallowed).not.toContain("Googlebot");
  });

  test("本番も包括的な規則を最後に置く", () => {
    delete process.env.DEMO_MODE;
    expect(lastRule(robots())?.userAgent).toBe("*");
  });
});
