import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { HealthChart } from "./HealthChart";
import type { HealthResult } from "@/lib/healthData";
import { buildHealthSeries } from "@/lib/healthSeries";

const AUGUST = [
  "- 2026-08-12 体重=66.8kg 体温=36.4",
  "- 2026-08-13 体重=66.6kg",
  "- 2026-08-14 体重=66.4kg",
].join("\n");

function chart(
  memo: string,
  item: string | null = null,
  days = 30,
  extra: Partial<Extract<HealthResult, { kind: "chart" }>> = {},
): string {
  const result: HealthResult = {
    kind: "chart",
    series: buildHealthSeries([{ itemNo: "4551", memo }], item, days),
    query: "#健康管理",
    omittedNotes: 0,
    ...extra,
  };
  return renderToStaticMarkup(<HealthChart result={result} code="#健康管理" />);
}

describe("HealthChart", () => {
  test("項目名・最新値・増減・件数を線の外に出す", () => {
    const html = chart(AUGUST);
    expect(html).toContain("体重");
    expect(html).toContain("最新 66.4kg (8/14)");
    // 66.8 → 66.4 の増減。誤差付きの -0.40000000000000568 を出さない
    expect(html).toContain("-0.4kg");
    expect(html).toContain("3 件");
  });

  test("増えたときは符号を付ける", () => {
    const html = chart("- 2026-08-12 体重=66.0\n- 2026-08-14 体重=66.5");
    expect(html).toContain("+0.5");
  });

  test("線は点の数だけ座標を持つ", () => {
    const html = chart(AUGUST);
    const polyline = /<polyline points="([^"]+)"/.exec(html);
    expect(polyline?.[1].split(" ")).toHaveLength(3);
  });

  test("間隔が空いた区間は線をつながない", () => {
    // 8/14 と 8/30 は 16 日空いている (HEALTH_GAP_DAYS を超える)
    const html = chart(
      ["- 2026-08-13 体重=66.6", "- 2026-08-14 体重=66.4", "- 2026-08-30 体重=65.0"].join(
        "\n",
      ),
    );
    expect(html.match(/<polyline/g)).toHaveLength(2);
  });

  test("縦軸の目盛りを数字で出す (0 起点ではないので幅が読めない)", () => {
    const html = chart(AUGUST);
    expect(html).toContain("66.2");
    expect(html).toContain("67.0");
  });

  test("読み上げ用の要約を持つ", () => {
    const html = chart(AUGUST);
    expect(html).toContain(
      'aria-label="体重の折れ線グラフ。8/12 から 8/14 まで 3 件、最小 66.4kg、最大 66.8kg"',
    );
  });

  test("記録が無ければ検索式と、代わりに選べる項目を出す", () => {
    const html = chart(AUGUST, "血圧");
    expect(html).toContain("「血圧」の記録がありません");
    expect(html).toContain("#健康管理");
    expect(html).toContain("体重");
    expect(html).toContain("y= で選べます");
    expect(html).not.toContain("<svg");
  });

  test("1 件も記録が無いノートでは項目名を名乗らない", () => {
    const html = chart("# 健康管理\n\nまだ書いていない");
    expect(html).toContain("記録がありません");
    expect(html).not.toContain("「」");
  });

  test("期間の外にした点があれば数を言う", () => {
    const html = chart(
      ["- 2026-07-01 体重=70.0", "- 2026-08-13 体重=66.6", "- 2026-08-14 体重=66.4"].join(
        "\n",
      ),
      null,
      3,
    );
    expect(html).toContain("他 1 件は期間の外です");
  });

  test("読まなかったノートがあれば数を言う", () => {
    const html = chart(AUGUST, "体重", 30, { omittedNotes: 12 });
    expect(html).toContain("他 12 件のノートは読んでいません");
  });

  test("書き方のエラーは元のソースを添えて出す", () => {
    const html = renderToStaticMarkup(
      <HealthChart
        result={{ kind: "error", error: "知らない設定「sort」です" }}
        code="#健康管理\nsort=updated"
      />,
    );
    expect(html).toContain("グラフの書き方のエラー");
    expect(html).toContain("知らない設定");
    expect(html).toContain("sort=updated");
  });
});
