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
// 前後の検索 (findItemNeighbors) は枠では待たない (docs/86 §4-18)。
// 呼ばれたら calls に残るので、枠の描画で走っていないことを確かめられる
vi.mock("@/lib/prefs/itemListContext", () => ({
  resolveListParams: async (q: string | string[] | undefined) => {
    mocks.calls.push("params");
    return { query: typeof q === "string" ? q : "", sort: "accessed" };
  },
  findItemNeighbors: async () => {
    mocks.calls.push("neighbors");
    return { prev: "4950", next: "4952" };
  },
}));

vi.mock("@/components/notepage/AutoNotePane", () => ({ AutoNotePane: mocks.stub("AutoNotePane") }));
vi.mock("@/components/item/NoteNav", () => ({ NoteNav: mocks.stub("NoteNav") }));
vi.mock("@/components/item/NoteView", () => ({ NoteView: mocks.stub("NoteView") }));
vi.mock("@/components/auth/LoginRequiredNotice", () => ({
  LoginRequiredNotice: mocks.stub("LoginRequiredNotice"),
}));
vi.mock("@/components/chrome/PageTransition", () => ({
  PageTransition: mocks.stub("PageTransition"),
}));
vi.mock("@/components/panes/PreviewPane", () => ({ PreviewPane: mocks.stub("PreviewPane") }));
vi.mock("@/components/item/PublicItemView", () => ({
  PublicItemView: mocks.stub("PublicItemView"),
}));
vi.mock("@/components/item/RecordAccess", () => ({ RecordAccess: mocks.stub("RecordAccess") }));
vi.mock("@/components/item/CloseNoteButton", () => ({
  CloseNoteButton: mocks.stub("CloseNoteButton"),
}));
vi.mock("@/components/notechrome/NoteChromeProvider", () => ({
  NoteChromeProvider: mocks.stub("NoteChromeProvider"),
}));
vi.mock("@/components/notechrome/NoteChromeBar", () => ({
  NoteChromeBar: mocks.stub("NoteChromeBar"),
}));

const { ItemDetail } = await import("./ItemDetail");
const { AutoNotePane } = await import("@/components/notepage/AutoNotePane");
const { NoteNav: ItemListNav } = await import("@/components/item/NoteNav");
const { NoteView: ItemView } = await import("@/components/item/NoteView");
const { LoginRequiredNotice } = await import("@/components/auth/LoginRequiredNotice");
const { PageTransition } = await import("@/components/chrome/PageTransition");
const { PreviewPane } = await import("@/components/panes/PreviewPane");
const { PublicItemView } = await import("@/components/item/PublicItemView");
const { RecordAccess } = await import("@/components/item/RecordAccess");
const { CloseNoteButton } = await import("@/components/item/CloseNoteButton");
const { NoteChromeProvider } = await import("@/components/notechrome/NoteChromeProvider");
const { NoteChromeBar } = await import("@/components/notechrome/NoteChromeBar");

type Props = Parameters<typeof ItemDetail>[0];
type Element = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

const render = async (overrides: Partial<Props>) =>
  (await ItemDetail({
    itemId: "4951",
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

test("全画面はログイン中なら記録・閉じる行と端末描画の本文・前後ナビを PageTransition に入れる", async () => {
  // Act
  const element = await render({
    saved: "1700000000",
    shell: { kind: "page" },
  });

  // Assert
  expect(element?.type).toBe(PageTransition);
  expect(childTypes(element!)).toEqual([RecordAccess, NoteChromeProvider, ItemListNav]);
  const [record, chrome, nav] = ([] as Element[]).concat(
    element!.props.children as Element[],
  );
  expect(record.props).toEqual({ itemId: "4951" });
  // 上端の行と本文は同じ器に入れる。行の直下に本文の操作を重ねるため (docs/108 §3)
  expect(childTypes(chrome)).toEqual([NoteChromeBar, ItemView]);
  const [bar, view] = ([] as Element[]).concat(chrome.props.children as Element[]);
  // 「閉じる」の行き先 (戻れる履歴が無いとき) は持ち回している一覧 (docs/86 §4-17)
  const close = bar.props.start as Element;
  expect(close.type).toBe(CloseNoteButton);
  expect(close.props).toEqual({ listHref: "/?q=npn&sort=accessed" });
  expect(view.props).toMatchObject({ itemId: "4951", saved: "1700000000", shell: "page" });
  expect(nav.props).toEqual({ itemId: "4951", query: "npn", sort: "accessed" });
  // ログイン中はノートを DB から引かない。本文は端末が API から取る (docs/123 §4-1)
  expect(mocks.calls).not.toContain("item");
  // 前後の検索は Suspense の中で後から引く。枠はそれを待たない
  expect(mocks.calls).not.toContain("neighbors");
});

test("全画面の未ログインは公開ノートなら読み取り専用、前後は引かない", async () => {
  // Arrange
  mocks.user = null;
  mocks.item = publicItem;

  // Act
  const element = await render({ shell: { kind: "page" } });

  // Assert
  expect(element?.type).toBe(PageTransition);
  expect(childTypes(element!)).toEqual([PublicItemView]);
  expect(mocks.calls).not.toContain("neighbors");
});

test("未登録・非公開は同じログインの案内に潰す", async () => {
  // Arrange
  mocks.user = null;

  // Act
  mocks.item = privateItem;
  const hidden = await render({ shell: { kind: "page" } });
  mocks.item = null;
  const missing = await render({ shell: { kind: "page" } });

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
    itemId: "4951",
    openHref: "/item/4951?q=npn&sort=accessed",
  });
  expect(childTypes(element!)).toEqual([ItemView, ItemListNav]);
  expect(mocks.calls).toContain("params");
  expect(mocks.calls).not.toContain("neighbors");
});

test("ペインの未ログインは番号を知らせず、素の /item を行き先にする", async () => {
  // Arrange
  mocks.user = null;
  mocks.item = publicItem;

  // Act
  const element = await render({ itemId: "10 x", shell: { kind: "pane" } });

  // Assert
  expect(element?.type).toBe(PreviewPane);
  expect(element!.key).toBeNull();
  expect(element!.props.itemId).toBeUndefined();
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
    itemId: "4951",
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
