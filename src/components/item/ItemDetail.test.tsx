import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Item } from "@/generated/prisma/client";

// 1 ノートの詳細の 3 つの器 (page / pane / auto) × ログイン状態。
// 中身の部品は DB やルーターを掴むので、ここでは「どの器に何を入れたか」を
// 要素の木から読む (default.test.tsx と同じ流儀)。公開判定と URL の組み立ては本物
const mocks = vi.hoisted(() => ({
  user: "tommie" as string | null,
  item: null as unknown,
  calls: [] as string[],
  // 部品の代役。要素の type を突き合わせるだけなので中身は問わない
  stub: (name: string) =>
    function Stub() {
      return name;
    },
}));

vi.mock("@/lib/auth/session", () => ({
  currentUser: async () => {
    mocks.calls.push("user");
    return mocks.user;
  },
}));
vi.mock("@/lib/items/read", () => ({
  getItem: async () => {
    mocks.calls.push("item");
    return mocks.item;
  },
}));
vi.mock("@/lib/prefs/itemListContext", () => ({
  resolveItemListContext: async (
    _itemNo: string,
    q: string | string[] | undefined,
  ) => {
    mocks.calls.push("ctx");
    return {
      query: typeof q === "string" ? q : "",
      sort: "accessed",
      neighbors: { prev: "4950", next: "4952" },
    };
  },
}));

vi.mock("@/components/notepage/AutoNotePane", () => ({ AutoNotePane: mocks.stub("AutoNotePane") }));
vi.mock("@/components/item/ItemListNav", () => ({ ItemListNav: mocks.stub("ItemListNav") }));
vi.mock("@/components/item/ItemView", () => ({ ItemView: mocks.stub("ItemView") }));
vi.mock("@/components/LoginRequiredNotice", () => ({
  LoginRequiredNotice: mocks.stub("LoginRequiredNotice"),
}));
vi.mock("@/components/PageTransition", () => ({
  PageTransition: mocks.stub("PageTransition"),
}));
vi.mock("@/components/PreviewPane", () => ({ PreviewPane: mocks.stub("PreviewPane") }));
vi.mock("@/components/item/PublicItemView", () => ({
  PublicItemView: mocks.stub("PublicItemView"),
}));
vi.mock("@/components/item/RecordAccess", () => ({ RecordAccess: mocks.stub("RecordAccess") }));

const { ItemDetail } = await import("./ItemDetail");
const { AutoNotePane } = await import("@/components/notepage/AutoNotePane");
const { ItemListNav } = await import("@/components/item/ItemListNav");
const { ItemView } = await import("@/components/item/ItemView");
const { LoginRequiredNotice } = await import("@/components/LoginRequiredNotice");
const { PageTransition } = await import("@/components/PageTransition");
const { PreviewPane } = await import("@/components/PreviewPane");
const { PublicItemView } = await import("@/components/item/PublicItemView");
const { RecordAccess } = await import("@/components/item/RecordAccess");

const recordAccessAction = async () => {};

type Props = Parameters<typeof ItemDetail>[0];
type Element = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

const render = async (overrides: Partial<Props>) =>
  (await ItemDetail({
    itemNo: "4951",
    q: "npn",
    sort: undefined,
    saved: undefined,
    shell: { kind: "pane" },
    ...overrides,
  })) as Element | null;

const childTypes = (element: Element) =>
  ([] as ReactNode[])
    .concat(element.props.children)
    .map((child) => (child as Element).type);

const publicItem = { publicAt: new Date(), deletedAt: null } as Item;
const privateItem = { publicAt: null, deletedAt: null } as Item;

beforeEach(() => {
  mocks.user = "tommie";
  mocks.item = privateItem;
  mocks.calls = [];
  // ペインの地色 (本番=灰 / それ以外=ピンク) と公開判定 (デモは公開なし) が env を見る
  vi.stubEnv("APP_ENV", "");
  vi.stubEnv("DEMO_MODE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("全画面はログイン中なら記録・本文・前後ナビを PageTransition に入れる", async () => {
  // Act
  const element = await render({
    saved: "1700000000",
    shell: { kind: "page", recordAccessAction },
  });

  // Assert
  expect(element?.type).toBe(PageTransition);
  expect(childTypes(element!)).toEqual([RecordAccess, ItemView, ItemListNav]);
  const [record, view, nav] = ([] as Element[]).concat(
    element!.props.children as Element[],
  );
  expect(record.props).toEqual({ itemNo: "4951", action: recordAccessAction });
  expect(view.props).toMatchObject({ itemNo: "4951", saved: "1700000000" });
  expect(nav.props).toEqual({
    prev: "4950",
    next: "4952",
    query: "npn",
    sort: "accessed",
  });
});

test("全画面の未ログインは公開ノートなら読み取り専用、前後は引かない", async () => {
  // Arrange
  mocks.user = null;
  mocks.item = publicItem;

  // Act
  const element = await render({ shell: { kind: "page", recordAccessAction } });

  // Assert
  expect(element?.type).toBe(PageTransition);
  expect(childTypes(element!)).toEqual([PublicItemView]);
  expect(mocks.calls).not.toContain("ctx");
});

test("未登録・非公開は同じログインの案内に潰す", async () => {
  // Arrange
  mocks.user = null;

  // Act
  mocks.item = privateItem;
  const hidden = await render({ shell: { kind: "page", recordAccessAction } });
  mocks.item = null;
  const missing = await render({ shell: { kind: "page", recordAccessAction } });

  // Assert
  expect(childTypes(hidden!)).toEqual([LoginRequiredNotice]);
  expect(childTypes(missing!)).toEqual([LoginRequiredNotice]);
});

test("ペインはログイン中なら番号を key に器を作り、全画面の行き先に検索状態を持たせる", async () => {
  // Act
  const element = await render({ saved: "1700000000", shell: { kind: "pane" } });

  // Assert
  expect(element?.type).toBe(PreviewPane);
  expect(element!.key).toBe("4951");
  expect(element!.props).toMatchObject({
    bgClass: "bg-pink-50",
    itemNo: "4951",
    openHref: "/item/4951?q=npn&sort=accessed",
  });
  expect(childTypes(element!)).toEqual([ItemView, ItemListNav]);
  expect(mocks.calls).toContain("ctx");
});

test("ペインの未ログインは番号を知らせず、素の /item を行き先にする", async () => {
  // Arrange
  mocks.user = null;
  mocks.item = publicItem;

  // Act
  const element = await render({ itemNo: "10 x", shell: { kind: "pane" } });

  // Assert
  expect(element?.type).toBe(PreviewPane);
  expect(element!.key).toBeNull();
  expect(element!.props.itemNo).toBeUndefined();
  expect(element!.props.openHref).toBe("/item/10%20x");
  expect(childTypes(element!)).toEqual([PublicItemView]);
});

test("自動のペインはログイン中なら AutoNotePane に同じ中身を入れる", async () => {
  // Act
  const element = await render({ q: "", shell: { kind: "auto" } });

  // Assert
  expect(element?.type).toBe(AutoNotePane);
  expect(element!.key).toBe("4951");
  expect(element!.props).toMatchObject({
    itemNo: "4951",
    openHref: "/item/4951",
  });
  expect(childTypes(element!)).toEqual([ItemView, ItemListNav]);
});

test("自動のペインは万一の未ログインでは何も出さない", async () => {
  // Arrange
  mocks.user = null;
  mocks.item = publicItem;

  // Act
  const element = await render({ shell: { kind: "auto" } });

  // Assert
  expect(element).toBeNull();
});
