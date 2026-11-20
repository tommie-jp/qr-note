import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { normalizeSecretText, type SecretTextEntry } from "@/lib/secret/search";
import type { SecretSearchState } from "@/lib/secret/searchSession";

// シークレット内の一致の節とトグル (docs/130-シークレット内検索計画.md §3)。
// 状態 (searchSession) だけを差し替え、照合 (secret/search.ts) は本物を通す
const mocks = vi.hoisted(() => ({
  state: { status: "off", error: null } as SecretSearchState,
}));

vi.mock("@/lib/secret/searchSession", () => ({
  useSecretSearch: () => mocks.state,
  enableSecretSearch: async () => {},
  disableSecretSearch: () => {},
}));

const { SecretSearchHits } = await import("./SecretSearchHits");
const { SecretSearchToggle } = await import("./SecretSearchToggle");

const A = "0421547b-ee29-4613-a6d4-da0f41f94054";
const B = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const PLAINTEXT = "ＡＢＣ銀行 口座 1234567";

function entry(name: string, itemId: string, title: string, label: string): SecretTextEntry {
  return { name, hash: "h", bytes: 10, refs: [{ itemId, title, label }] };
}

function loaded(extra: { skipped?: number; failed?: number } = {}): SecretSearchState {
  return {
    status: "on",
    index: {
      entries: [entry(A, "note-1", "銀行まとめ", "口座"), entry(B, "note-2", "", "Wi-Fi")],
      haystacks: new Map([
        [A, normalizeSecretText(PLAINTEXT)],
        [B, normalizeSecretText("hunter2")],
      ]),
      skipped: extra.skipped ?? 0,
      failed: extra.failed ?? 0,
    },
  };
}

const render = (query: string) =>
  renderToStaticMarkup(<SecretSearchHits query={query} sort="updated" />);

beforeEach(() => {
  mocks.state = { status: "off", error: null };
});

describe("SecretSearchHits", () => {
  test("切れていれば何も出さない", () => {
    expect(render("口座")).toBe("");
  });

  test("入れるのに失敗した理由を出す", () => {
    mocks.state = { status: "off", error: "暗号化がまだ設定されていません" };

    const html = render("口座");

    expect(html).toContain('role="alert"');
    expect(html).toContain("暗号化がまだ設定されていません");
  });

  test("読み込み中を知らせる", () => {
    mocks.state = { status: "loading" };

    expect(render("口座")).toContain("シークレットを読み込み中…");
  });

  test("一致したノートを題名とラベルで出し、ノートへのリンクにする", () => {
    mocks.state = loaded();

    const html = render("abc 1234");

    expect(html).toContain("シークレット内の一致 1 件");
    expect(html).toContain("銀行まとめ");
    expect(html).toContain("🔒 口座");
    // 検索語は href に載せない (開いた先の要求に語を運ばない)
    expect(html).toContain('href="/item/note-1"');
    expect(html).toContain('data-client-note=""');
    expect(html).not.toContain("note-2");
  });

  test("一致箇所の中身 (平文) は画面に出さない", () => {
    mocks.state = loaded();

    const html = render("1234567");

    expect(html).toContain("シークレット内の一致 1 件");
    expect(html).not.toContain("1234567");
    expect(html).not.toContain("ＡＢＣ銀行");
    expect(html).not.toContain("abc銀行");
  });

  test("題名の無いノートは (無題) と出す", () => {
    mocks.state = loaded();

    expect(render("hunter2")).toContain("(無題)");
  });

  test("一致が無ければ 0 件と出す", () => {
    mocks.state = loaded();

    expect(render("どこにも無い語")).toContain("シークレット内の一致 0 件");
  });

  test("検索語が無いときは対象の件数だけ知らせ、全断片を並べない", () => {
    mocks.state = loaded();

    const html = render("");

    expect(html).toContain("対象 2 件");
    expect(html).not.toContain("銀行まとめ");
  });

  test("探せなかった断片の数を断る", () => {
    mocks.state = loaded({ skipped: 2, failed: 1 });

    const html = render("口座");

    expect(html).toContain("大きさの上限を超えた 2 件は対象外です。");
    expect(html).toContain("1 件は読み取れず対象外です。");
  });
});

describe("SecretSearchToggle", () => {
  test("切れているときは押されていない釦", () => {
    const html = renderToStaticMarkup(<SecretSearchToggle />);

    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="シークレット内も検索"');
  });

  test("入っているときは押された釦で、やめる操作を名乗る", () => {
    mocks.state = loaded();

    const html = renderToStaticMarkup(<SecretSearchToggle />);

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="シークレット内の検索をやめる"');
  });

  test("読み込み中も入っている扱いで、忙しい印を付ける", () => {
    mocks.state = { status: "loading" };

    const html = renderToStaticMarkup(<SecretSearchToggle />);

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-busy="true"');
  });
});
