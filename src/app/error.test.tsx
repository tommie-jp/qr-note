import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import ErrorPage from "./error";

function render(error: Error & { digest?: string }): string {
  return renderToStaticMarkup(<ErrorPage error={error} reset={() => {}} />);
}

// Next.js が配布をまたいだ Server Action の呼び出しで投げる例外と同じ形
// (node_modules/next/dist/client/components/unrecognized-action-error.js)
function unrecognizedAction(): Error {
  const error = new Error('Server Action "60dc" was not found on the server.');
  error.name = "UnrecognizedActionError";
  return error;
}

describe("エラー画面", () => {
  test("配布をまたいだ操作は、新しい版になったことと読み込み直す釦を出す", () => {
    const html = render(unrecognizedAction());

    expect(html).toContain("新しい版");
    expect(html).toContain("下書き");
    expect(html).toContain("読み込み直す");
    // 再試行しても同じ ID を送り直すだけで通らないので出さない
    expect(html).not.toContain("再試行");
  });

  test("ほかのエラーは理由とエラー ID を出す", () => {
    const error: Error & { digest?: string } = new Error("DB に繋がりません");
    error.digest = "1234567890";

    const html = render(error);

    expect(html).toContain("DB に繋がりません");
    expect(html).toContain("1234567890");
    expect(html).toContain("再試行");
  });

  test("理由が空でも落ちない", () => {
    const html = render(new Error(""));

    expect(html).toContain("エラーが発生しました");
  });
});
