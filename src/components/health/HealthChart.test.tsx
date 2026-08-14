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

// 記録欄つき (ノート閲覧と同じ形)
function chartWithForm(memo: string, item: string | null = null): string {
  return renderToStaticMarkup(
    <HealthChart
      result={{
        kind: "chart",
        series: buildHealthSeries([{ itemNo: "4551", memo }], item, 30),
        query: "#健康管理",
        omittedNotes: 0,
      }}
      code="#健康管理"
      onRecord={async () => {}}
    />,
  );
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

  // 毎日つけた記録 (丸を描く上限を超える量)
  function dailyMemo(count: number): string {
    const start = Date.UTC(2026, 5, 1);
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(start + index * 86400000)
        .toISOString()
        .slice(0, 10);
      return `- ${date} 体重=${66 + (index % 3) / 10}`;
    }).join("\n");
  }

  test("点が多いときは丸を描かない (線が団子になる)", () => {
    expect(chart(dailyMemo(60), null, 400).match(/<circle/g)).toHaveLength(60);
    expect(chart(dailyMemo(61), null, 400).match(/<circle/g)).toBeNull();
  });

  test("点が多くても、1 点だけ離れた記録には丸を描く", () => {
    // 線分にならない区間なので、丸が無いとその記録が画面から消える
    const html = chart(`${dailyMemo(61)}\n- 2026-08-20 体重=65`, null, 400);
    expect(html.match(/<circle/g)).toHaveLength(1);
  });

  test("他の項目が多いときは数だけ言う", () => {
    const html = chart(
      "- 2026-08-14 体重=66.4 体温=36.5 脈拍=62 歩数=8000 睡眠=7 体脂肪=20",
      "体重",
      30,
    );
    expect(html).toContain("体温 / 脈拍 / 歩数 / 睡眠 他 1 種類");
  });

  const BLOOD_PRESSURE = [
    "- 2026-08-12 血圧=124/80mmHg",
    "- 2026-08-13 血圧=120/78mmHg",
    "- 2026-08-14 血圧=118/76mmHg",
  ].join("\n");

  test("対の値 (血圧) は 2 本の線になる", () => {
    const html = chart(BLOOD_PRESSURE);
    expect(html.match(/<polyline/g)).toHaveLength(2);
    // 上の線が 1 つ目 (計画 §9)。同じ青の濃淡を使う
    expect(html).toContain('stroke="#2563eb"');
    expect(html).toContain('stroke="#38bdf8"');
  });

  test("最新値と増減は本文と同じ / つなぎで出す", () => {
    const html = chart(BLOOD_PRESSURE);
    expect(html).toContain("最新 118/76mmHg (8/14)");
    expect(html).toContain("-6/-4mmHg");
  });

  test("1 回しか測っていない線があれば増減を出さない (+0 は嘘になる)", () => {
    const html = chart(
      [
        "- 2026-08-01 血圧=124/80mmHg",
        "- 2026-08-02 血圧=120mmHg",
        "- 2026-08-03 血圧=118mmHg",
      ].join("\n"),
    );
    expect(html).toContain("最新 118mmHg");
    expect(html).not.toContain("+0");
  });

  test("線が 2 本なら丸の総数で上限を数える", () => {
    // 30 日 × 2 本 = 60 個までは描く
    const days = (count: number) =>
      Array.from({ length: count }, (_, i) => {
        const date = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
        return `- ${date} 血圧=${118 + (i % 3)}/${76 + (i % 2)}mmHg`;
      }).join("\n");
    expect(chart(days(30), null, 400).match(/<circle/g)).toHaveLength(60);
    expect(chart(days(31), null, 400).match(/<circle/g)).toBeNull();
  });

  test("増減の符号は 1 つずつ付ける (+10/4 では 2 つ目が読めない)", () => {
    const html = chart(
      "- 2026-08-13 血圧=118/80mmHg\n- 2026-08-14 血圧=128/76mmHg",
    );
    expect(html).toContain("+10/-4mmHg");
  });

  test("読み上げは線を 1 本ずつ言う (色と並びは音にならない)", () => {
    const html = chart(BLOOD_PRESSURE);
    expect(html).toContain("1 本目 最小 118mmHg、最大 124mmHg");
    expect(html).toContain("2 本目 最小 76mmHg、最大 80mmHg");
  });

  test("対の値の記録欄は入力を 2 つ出す", () => {
    const html = chartWithForm(BLOOD_PRESSURE);
    expect(html).toContain('aria-label="血圧の値 1 つ目"');
    expect(html).toContain('aria-label="血圧の値 2 つ目"');
  });

  test("記録欄は保存の口を渡したときだけ出る", () => {
    expect(chart(AUGUST)).not.toContain('type="date"');
    expect(chartWithForm(AUGUST)).toContain('type="date"');
    // 項目名と単位は本文から引き継ぐ (人に選ばせない)
    expect(chartWithForm(AUGUST)).toContain("kg");
    expect(chartWithForm(AUGUST)).toContain("記録");
  });

  test("まだ記録が無くても、項目が判っていれば記録欄を出す", () => {
    const html = chartWithForm("# 健康管理\n\n#健康管理", "体重");
    expect(html).toContain('type="date"');
    expect(html).toContain("「体重」の記録がありません");
  });

  test("項目が判らないときは記録欄を出さず、書き方を教える", () => {
    const html = chartWithForm("# 健康管理\n\n#健康管理");
    expect(html).not.toContain('type="date"');
    expect(html).toContain("y=体重");
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
