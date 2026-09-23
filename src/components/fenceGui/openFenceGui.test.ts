import { beforeAll, describe, expect, test } from "vitest";
import type { FenceEditor } from "fence-kit/shell";
import { loadFenceEditors } from "@/lib/fenceGui/editors";
import {
  type FenceGuiFrame,
  type FenceGuiHost,
  openFenceGui,
} from "./openFenceGui";

// iframe を webview の代わりにする橋 (docs/99)。上流 playground の
// index.dom.test.ts の写し。jsdom は依存に無いので、node の EventTarget で
// iframe と window の偽物を組む (見るのは橋の約束だけ)

const DOC = [
  "# 例",
  "",
  "```breadboard",
  "board: half",
  "parts:",
  "  R1: resistor a5 a10 330",
  "```",
  "",
].join("\n");

// 本文の 1 行目 (0 始まり)
const FENCE_LINE = 3;

class FakeFrame extends EventTarget implements FenceGuiFrame {
  srcdoc = "";
  readonly sent: { message: unknown; origin: string }[] = [];
  readonly contentWindow = {
    postMessage: (message: unknown, origin: string) => {
      this.sent.push({ message, origin });
    },
  };
}

let editors: readonly FenceEditor[] = [];
beforeAll(async () => {
  editors = await loadFenceEditors(["breadboard"]);
});

function openOne() {
  const frame = new FakeFrame();
  // node の EventTarget は MessageEvent の聞き手も受ける (中身は Event)
  const host = new EventTarget() as EventTarget & FenceGuiHost;
  const handle = openFenceGui({
    frame,
    host,
    editors,
    text: DOC,
    fenceLine: FENCE_LINE,
    scriptUri: "/fence/map.web.js",
  });
  return { frame, host, handle };
}

// 中の頁から届いた知らせ。source は偽の contentWindow (本物の MessageEvent は
// source に MessagePort しか受けないので、Event に生やす)
function fromFrame(host: EventTarget, source: unknown, data: unknown): void {
  const event = new Event("message");
  Object.defineProperties(event, {
    source: { value: source },
    data: { value: data },
  });
  host.dispatchEvent(event);
}

// session.handle は非同期。書き戻しを待つ
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("openFenceGui", () => {
  test("殻の頁を丸ごと srcdoc に書く (殻は 1 行も変えずに動く)", () => {
    const { frame, handle } = openOne();

    expect(frame.srcdoc).toContain("<!DOCTYPE html>");
    expect(frame.srcdoc).toContain('data-part="R1"');
    expect(frame.srcdoc).toContain('src="/fence/map.web.js"');
    handle.close();
  });

  test("殻は自前の履歴を持つ (エディタの元に戻すは届かない)", () => {
    const { frame, handle } = openOne();

    expect(frame.srcdoc).toContain("cf-own-undo");
    handle.close();
  });

  // QR ノートにダークモードは無い。iframe の中には親の CSS が効かず、sandbox では
  // contentDocument にも書けないので、頁の頭に印を書いておく (上流 52 の docs/59
  // の決め 4)。上流が <html の書き方を変えたら、版を上げたときにここで落ちる
  test("端末が暗色でも明るいまま (頁の頭に印を書く)", () => {
    const { frame, handle } = openOne();

    expect(frame.srcdoc).toMatch(/^<!DOCTYPE html><html data-theme="light" /);
    handle.close();
  });

  // 宛先は '*'。sandbox の頁の出所は不透明 ("null") で名指しでは届かない。
  // 受け手は自分の iframe の contentWindow に固定されている
  test("中の頁ができるまで溜め、load で流す", async () => {
    const { frame, host, handle } = openOne();

    fromFrame(host, frame.contentWindow, {
      kind: "setField",
      part: "R1",
      field: "value",
      text: "1k",
    });
    await settle();
    expect(frame.sent).toEqual([]);

    frame.dispatchEvent(new Event("load"));
    expect(frame.sent.length).toBeGreaterThan(0);
    expect(frame.sent.every((one) => one.origin === "*")).toBe(true);
    handle.close();
  });

  test("中から来た操作で写しが書き換わり、text() が返す", async () => {
    const { frame, host, handle } = openOne();
    frame.dispatchEvent(new Event("load"));

    fromFrame(host, frame.contentWindow, {
      kind: "setField",
      part: "R1",
      field: "value",
      text: "1k",
    });
    await settle();

    expect(handle.text()).toBe(DOC.replace("330", "1k"));
    handle.close();
  });

  test("自分の iframe 以外から来た知らせは聞かない", async () => {
    const { frame, host, handle } = openOne();
    frame.dispatchEvent(new Event("load"));

    fromFrame(host, {}, { kind: "setField", part: "R1", field: "value", text: "1k" });
    await settle();

    expect(handle.text()).toBe(DOC);
    handle.close();
  });

  test("閉じたら聞き耳を外し、頁を空にする", async () => {
    const { frame, host, handle } = openOne();
    frame.dispatchEvent(new Event("load"));

    handle.close();
    fromFrame(host, frame.contentWindow, {
      kind: "setField",
      part: "R1",
      field: "value",
      text: "1k",
    });
    await settle();

    expect(frame.srcdoc).toBe("");
    expect(handle.text()).toBe(DOC);
  });
});
