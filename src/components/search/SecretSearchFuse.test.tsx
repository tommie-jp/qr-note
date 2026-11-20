import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

// 自動施錠までの残りを見せる導火線 (docs/130 §3-1)。
// 数え直しの時刻だけを差し替える
const mocks = vi.hoisted(() => ({ startedAt: null as number | null }));

vi.mock("@/lib/secret/session", () => ({
  SECRET_IDLE_LOCK_MS: 5 * 60 * 1000,
  useSecretIdleStartedAt: () => mocks.startedAt,
}));

const { fuseBurntRatio, SecretSearchFuse } = await import("./SecretSearchFuse");

const MINUTE = 60 * 1000;

beforeEach(() => {
  mocks.startedAt = null;
});

describe("fuseBurntRatio", () => {
  test("数え直した瞬間は 0、5 分で燃え尽きる", () => {
    expect(fuseBurntRatio(1000, 1000)).toBe(0);
    expect(fuseBurntRatio(0, 2.5 * MINUTE)).toBe(0.5);
    expect(fuseBurntRatio(0, 5 * MINUTE)).toBe(1);
  });

  test("範囲の外は 0〜1 に収める (時計のずれ・燃え尽きた後)", () => {
    expect(fuseBurntRatio(1000, 0)).toBe(0);
    expect(fuseBurntRatio(0, 60 * MINUTE)).toBe(1);
  });
});

describe("SecretSearchFuse", () => {
  test("施錠中は何も出さない", () => {
    expect(renderToStaticMarkup(<SecretSearchFuse />)).toBe("");
  });

  test("数え直した直後は、根元から 5 分かけて燃える", () => {
    mocks.startedAt = 1_000_000;

    const html = renderToStaticMarkup(<SecretSearchFuse />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('dur="300000ms"');
    expect(html).toContain('stroke-dashoffset="0"');
    expect(html).toContain('to="-100"');
    expect(html).toContain('keyPoints="0;1"');
  });

  test("火は赤い丸と、長さの変わる放射状の線 8 本", () => {
    mocks.startedAt = 1_000_000;

    const html = renderToStaticMarkup(<SecretSearchFuse />);

    expect(html.match(/<line /g)).toHaveLength(8);
    expect(html).toContain("stroke-red-600");
    expect(html).toContain("fill-red-600");
    // 縦横と斜めで伸び縮みの拍子が違う (同時に伸びると脈動に見える)
    expect(html.match(/<animateTransform /g)).toHaveLength(2);
    expect(html).toContain('dur="0.45s"');
    expect(html).toContain('dur="0.6s"');
  });

  test("押せなくしない (釦の上に重ねるが指は通す)", () => {
    mocks.startedAt = 1_000_000;

    expect(renderToStaticMarkup(<SecretSearchFuse />)).toContain("pointer-events-none");
  });
});
