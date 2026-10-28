import type { ReactElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";

// 前後ナビを後から流す器 (docs/86 §4-18)。中身の検索は差し替え、
// 「文脈が無ければ検索しない」「あれば Suspense の中で引く」を見る
const mocks = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@/lib/prefs/itemListContext", () => ({
  findItemNeighbors: async () => {
    mocks.calls.push("neighbors");
    return { prev: "a", next: "c" };
  },
}));

const { ItemListNavSection } = await import("./ItemListNavSection");
const { ItemListNav } = await import("./ItemListNav");

beforeEach(() => {
  mocks.calls = [];
});

type Element = ReactElement<{ children?: ReactElement; fallback?: unknown }>;

test("一覧の文脈が無ければ何も出さず、検索も流さない", () => {
  const element = ItemListNavSection({
    itemId: "b",
    params: { query: "", sort: "accessed" },
  });

  expect(element).toBeNull();
  expect(mocks.calls).toEqual([]);
});

test("文脈があれば Suspense の中で前後を引き、ナビを描く", async () => {
  const element = ItemListNavSection({
    itemId: "b",
    params: { query: "npn", sort: "accessed" },
  }) as Element;

  // 枠の描画の時点ではまだ検索していない
  expect(mocks.calls).toEqual([]);
  expect(element.props.fallback).toBeNull();
  const inner = element.props.children as ReactElement<Record<string, unknown>>;
  const Neighbors = inner.type as (props: unknown) => Promise<ReactElement>;
  const nav = await Neighbors(inner.props);

  expect(mocks.calls).toEqual(["neighbors"]);
  expect(nav.type).toBe(ItemListNav);
  expect(nav.props).toEqual({ prev: "a", next: "c", query: "npn", sort: "accessed" });
});
