import { beforeEach, expect, test, vi } from "vitest";

// 横取り遷移の children (docs/86)。未ログインなら一覧を伏せ、@detail 側の
// ログイン案内・公開ノートを残す。auth/session.ts は cookies() を呼ぶので差し替える
const mocks = vi.hoisted(() => ({
  user: "tommie" as string | null,
}));

vi.mock("@/lib/auth/session", () => ({
  currentUser: async () => mocks.user,
}));

// Home は DB と cookies() を読むので、ここでは「Home を呼ぶかどうか」だけを見る
vi.mock("./page", () => ({
  default: function Home() {
    return null;
  },
}));

import Home from "./page";
import Default from "./default";

beforeEach(() => {
  mocks.user = "tommie";
});

test("未ログインなら一覧 (Home) を描かずに空を返す", async () => {
  mocks.user = null;

  const element = await Default();

  expect(element).toBeNull();
});

test("ログイン済みなら検索の殻 (Home) を描く。検索語は端末が URL から読む", async () => {
  const element = await Default();

  expect(element?.type).toBe(Home);
  expect(element?.props).toEqual({});
});
