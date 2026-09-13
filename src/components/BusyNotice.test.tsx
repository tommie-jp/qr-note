import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { BusyNotice } from "./BusyNotice";
import { BUSY_NOTICE_CLASS, BUSY_SPINNER_CLASS } from "./ui";

const SPINNER = `<span aria-hidden="true" class="${BUSY_SPINNER_CLASS}"></span>`;

// 録音の自動停止・お絵かきの失敗のように、進み具合を持たない知らせ
test("busy を与えなければ文字だけの赤バナーで、スピナーの席を持たない", () => {
  const html = renderToStaticMarkup(
    <BusyNotice aria-live="polite">録音を止めました</BusyNotice>,
  );

  expect(html).toBe(
    `<p aria-live="polite" class="${BUSY_NOTICE_CLASS}">録音を止めました</p>`,
  );
});

test("busy が true の間は文字の前にスピナーを出す", () => {
  const html = renderToStaticMarkup(
    <BusyNotice aria-live="polite" busy>
      読み取り中
    </BusyNotice>,
  );

  expect(html).toBe(
    `<p aria-live="polite" class="${BUSY_NOTICE_CLASS} flex items-center gap-2">${SPINNER}読み取り中</p>`,
  );
});

// 処理が終わって結果の文言だけが残る間も、横並びの形は変えない
// (スピナーが消えるだけで、文字の位置の揃え方は同じ)
test("busy が false ならスピナーを消し、横並びの形は保つ", () => {
  const html = renderToStaticMarkup(
    <BusyNotice aria-live="polite" busy={false}>
      3 件読み取りました
    </BusyNotice>,
  );

  expect(html).toContain(`class="${BUSY_NOTICE_CLASS} flex items-center gap-2"`);
  expect(html).not.toContain("animate-spin");
});

test("読み上げの属性は渡したものだけを出す", () => {
  const status = renderToStaticMarkup(
    <BusyNotice role="status" busy>
      読み込み中…
    </BusyNotice>,
  );
  const progress = renderToStaticMarkup(
    <BusyNotice aria-live="polite" aria-busy busy>
      取得中…
    </BusyNotice>,
  );

  expect(status).toMatch(/^<p role="status" class=/);
  expect(status).not.toContain("aria-live");
  expect(status).not.toContain("aria-busy");
  expect(progress).toMatch(/^<p aria-live="polite" aria-busy="true" class=/);
});

test("置き場ごとの配置は BUSY_NOTICE_CLASS の後ろに足す", () => {
  const html = renderToStaticMarkup(
    <BusyNotice aria-live="polite" className="mx-3 mb-2">
      保存できませんでした
    </BusyNotice>,
  );

  expect(html).toContain(`class="${BUSY_NOTICE_CLASS} mx-3 mb-2"`);
});
