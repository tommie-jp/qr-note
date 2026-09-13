import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { SubmitButton } from "./SubmitButton";
import {
  PRIMARY_BUTTON_CLASS,
  SUBMIT_ICON_SPINNER_CLASS,
  SUBMIT_SPINNER_CLASS,
} from "./ui";

// useFormStatus は <form> の外で描くと常に pending: false を返し、静的描画では
// 送信中を作れない (このリポジトリは jsdom を持たない。HeaderMenu.test.tsx と
// 同じ制約)。送信中の見た目を確かめるため、react-dom の useFormStatus だけを
// 差し替える。本物の送信 (二重送信の防止など) はブラウザで確認する
const mocks = vi.hoisted(() => ({ pending: false }));

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    useFormStatus: () => ({
      pending: mocks.pending,
      data: null,
      method: null,
      action: null,
    }),
  };
});

beforeEach(() => {
  mocks.pending = false;
});

test("送信中でなければ主ボタンの submit で、スピナーを出さない", () => {
  const html = renderToStaticMarkup(<SubmitButton>保存</SubmitButton>);

  expect(html).toContain('type="submit"');
  expect(html).toContain(PRIMARY_BUTTON_CLASS);
  expect(html).toContain('aria-busy="false"');
  expect(html).not.toContain('disabled=""');
  expect(html).not.toContain("animate-spin");
  expect(html).toContain(">保存</button>");
});

// 押しても無反応に見えないように (docs/11-アプリ的UIUX計画.md §1-1)。
// disabled は二重送信も止める
test("送信中は止めて、文字の前に小さなスピナーと送信中の文字を出す", () => {
  mocks.pending = true;

  const html = renderToStaticMarkup(
    <SubmitButton pendingLabel="送信中">保存</SubmitButton>,
  );

  expect(html).toContain('disabled=""');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain(
    `<span aria-hidden="true" class="${SUBMIT_SPINNER_CLASS}"></span>送信中`,
  );
  expect(html).not.toContain("保存");
});

test("className は主ボタンの見た目の後ろに足す", () => {
  const html = renderToStaticMarkup(
    <SubmitButton className="w-full">保存</SubmitButton>,
  );

  expect(html).toContain(`class="${PRIMARY_BUTTON_CLASS} w-full"`);
});

// 下部バーの更新 (EditToolbar) の形。portal で DOM が form の外に出るので
// submit の関連付けに頼らず、押したら呼ぶ側が requestSubmit() する
test("overrideClassName と onClick を与えると主ボタンの形を使わない type=button になる", () => {
  const html = renderToStaticMarkup(
    <SubmitButton
      overrideClassName="slot"
      className="w-full"
      onClick={() => {}}
    >
      更新
    </SubmitButton>,
  );

  expect(html).toContain('type="button"');
  expect(html).toContain('class="slot"');
  expect(html).not.toContain(PRIMARY_BUTTON_CLASS);
});

test("アイコンは送信中だけ、アイコンと同じ寸法のスピナーに入れ替わる", () => {
  const icon = <svg id="save-icon" />;
  const render = () =>
    renderToStaticMarkup(
      <SubmitButton icon={icon} pendingLabel="更新中">
        更新
      </SubmitButton>,
    );

  const idle = render();
  mocks.pending = true;
  const pending = render();

  expect(idle).toContain('<svg id="save-icon"></svg>更新');
  expect(idle).not.toContain("animate-spin");
  expect(pending).not.toContain("save-icon");
  expect(pending).toContain(
    `<span aria-hidden="true" class="${SUBMIT_ICON_SPINNER_CLASS}"></span>更新中`,
  );
});
