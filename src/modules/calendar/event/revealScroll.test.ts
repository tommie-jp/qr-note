import { describe, expect, it } from "vitest";
import { weekTopScrollTop } from "./revealScroll";

describe("weekTopScrollTop", () => {
  it("下にある週を、貼り付いた見出し行のすぐ下へ送る", () => {
    expect(weekTopScrollTop({ scrollTop: 0, rowTop: 500, viewTop: 120 })).toBe(380);
  });

  it("上に隠れた週は戻して見出し行のすぐ下へ出す", () => {
    expect(weekTopScrollTop({ scrollTop: 800, rowTop: -100, viewTop: 120 })).toBe(580);
  });

  it("すでに一番上にある週は動かさない", () => {
    expect(weekTopScrollTop({ scrollTop: 300, rowTop: 120, viewTop: 120 })).toBe(300);
  });

  it("0 より上へは送らない (最初の週)", () => {
    expect(weekTopScrollTop({ scrollTop: 0, rowTop: 60, viewTop: 120 })).toBe(0);
  });

  it("端数は丸める", () => {
    expect(weekTopScrollTop({ scrollTop: 10, rowTop: 200.6, viewTop: 100.2 })).toBe(110);
  });
});
