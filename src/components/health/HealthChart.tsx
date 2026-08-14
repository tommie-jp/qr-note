import type { HealthResult } from "@/lib/healthData";
import {
  formatMonthDay,
  splitSegments,
  type HealthAxis,
  type HealthPoint,
} from "@/lib/healthSeries";
import { ERROR_SOURCE_CLASS } from "@/components/ui";

interface HealthChartProps {
  result: HealthResult;
  // エラー時に「何を書いたか」を出すための元ソース
  code: string;
}

// 図の座標系。**幅は viewBox で決めて画面幅には合わせる** (w-full)。
// 文字も線も同じ比率で伸縮するので、狭い画面でも配置が崩れない
const VIEW_W = 320;
const VIEW_H = 150;
// 左は目盛りの数字、下は日付のぶんだけ空ける
const PAD_L = 38;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 18;
const PLOT_W = VIEW_W - PAD_L - PAD_R;
const PLOT_H = VIEW_H - PAD_T - PAD_B;

// 点の丸を描く上限。これより多いと丸が線を埋めて団子になる
const MAX_DOTS = 60;

// 日付ラベルを 3 つ出すのに要る点の数。2 点しかないのに中間を足しても
// 両端のどちらかと重なるだけ
const MIN_POINTS_FOR_MIDDLE_LABEL = 5;

// 色は Tailwind の値をそのまま数値で持つ (SVG の属性はクラスを解さない)。
// 線は主ボタンと同じ blue-600、目盛りは gray-200、文字は gray-500
const LINE_COLOR = "#2563eb";
const GRID_COLOR = "#e5e7eb";
const LABEL_COLOR = "#6b7280";

// 誤差の付いた引き算 (66.4 - 66.8 = -0.40000000000000568) をそのまま出さない
function roundDelta(value: number): number {
  return Number(value.toFixed(2));
}

function formatValue(value: number, unit: string): string {
  return `${value}${unit}`;
}

// 横位置。**日付の間隔をそのまま距離にする** (点の個数で割らない) ので、
// 3 日空けた記録は 3 日ぶん離れて見える。1 点だけのときは真ん中に置く
function xOf(point: HealthPoint, first: number, last: number): number {
  if (last === first) {
    return PAD_L + PLOT_W / 2;
  }
  return PAD_L + ((point.day - first) / (last - first)) * PLOT_W;
}

function yOf(value: number, axis: HealthAxis): number {
  const span = axis.hi - axis.lo;
  if (span === 0) {
    return PAD_T + PLOT_H / 2;
  }
  return PAD_T + ((axis.hi - value) / span) * PLOT_H;
}

// 日付ラベルを出す点 (最初・真ん中・最後)。真ん中は点が十分にあるときだけ
function labelPoints(points: readonly HealthPoint[]): HealthPoint[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length < MIN_POINTS_FOR_MIDDLE_LABEL) {
    return first === last ? [first] : [first, last];
  }
  return [first, points[Math.floor(points.length / 2)], last];
}

// 読み上げ用の 1 文。**グラフは目で見る物なので、そのままでは何も伝わらない。**
// 期間・件数・最小最大を文にして持たせる (表がセルごとに読み上げ文を持つのと
// 同じ考え方。docs/77 の MatrixTable と揃える)
function chartSummary(
  item: string,
  unit: string,
  points: readonly HealthPoint[],
): string {
  const values = points.map((point) => point.value);
  const from = formatMonthDay(points[0].date);
  const to = formatMonthDay(points[points.length - 1].date);
  const min = formatValue(Math.min(...values), unit);
  const max = formatValue(Math.max(...values), unit);
  return `${item}の折れ線グラフ。${from} から ${to} まで ${points.length} 件、最小 ${min}、最大 ${max}`;
}

// ```health フェンスを折れ線に差し替える (docs/83-健康管理フェンス計画.md)。
//
// 集計はサーバ側で済んでいる (buildHealthCharts) ので、ここは並べるだけ。
// 状態を持たないので "use client" は要らず、オフラインの閲覧 (クライアント)
// からも同じ形で描ける (MatrixTable と同じ立ち位置)。
export function HealthChart({ result, code }: HealthChartProps) {
  // 書き方の誤りは「何が悪いか」と元のソースを添えて出す (MatrixTable /
  // QuizFence と同じ作法)。黙ってコードブロックに落とさない
  if (result.kind === "error") {
    return (
      <div className="my-4 rounded border border-red-300 bg-red-50 p-3">
        <p className="text-red-700">グラフの書き方のエラー: {result.error}</p>
        <pre className={ERROR_SOURCE_CLASS}>{code}</pre>
      </div>
    );
  }

  const { series, query } = result;
  const { points, axis, unit } = series;

  // 0 件で空の枠を出すと「グラフが壊れている」ように見える。何を探したかと、
  // **代わりに何があるか** (y= で選べる項目) を添えて言い切る
  if (points.length === 0 || axis === null) {
    return (
      <p className="my-4 rounded border border-gray-200 bg-gray-50 p-3 text-gray-600">
        {series.item === ""
          ? "記録がありません"
          : `「${series.item}」の記録がありません`}
        {query && <span className="ml-1 font-mono">({query})</span>}
        {series.otherItems.length > 0 && (
          <span className="ml-1">
            記録がある項目: {series.otherItems.join(" / ")} (y= で選べます)
          </span>
        )}
      </p>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const delta = roundDelta(last.value - first.value);
  const segments = splitSegments(points);

  return (
    <div className="my-4">
      <p className="mb-1 text-sm text-gray-600">
        <span className="font-medium text-gray-700">{series.item}</span>
        {/* 最新値を先に出す。グラフを開く目的の半分は「いまいくつか」で、
            それは線を目で追わなくても読める場所に置く */}
        <span className="ml-3 whitespace-nowrap">
          最新 {formatValue(last.value, unit)} ({formatMonthDay(last.date)})
        </span>
        {/* 期間内の増減。符号を必ず付ける (「-0.4」と「0.4」を見間違えない) */}
        {points.length > 1 && (
          <span className="ml-3 whitespace-nowrap">
            {delta >= 0 ? "+" : ""}
            {formatValue(delta, unit)}
          </span>
        )}
        <span className="ml-3 whitespace-nowrap">{points.length} 件</span>
      </p>
      <div className="rounded border border-gray-200 bg-white p-2">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-auto w-full"
          role="img"
          aria-label={chartSummary(series.item, unit, points)}
        >
          {/* 目盛り線と数字。0 起点ではなくデータの範囲に合わせた軸なので、
              数字が無いと「上がった / 下がった」の幅が読めない */}
          {axis.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD_L}
                y1={yOf(tick, axis)}
                x2={VIEW_W - PAD_R}
                y2={yOf(tick, axis)}
                stroke={GRID_COLOR}
                strokeWidth={1}
              />
              <text
                x={PAD_L - 4}
                y={yOf(tick, axis) + 3}
                textAnchor="end"
                fontSize={9}
                fill={LABEL_COLOR}
              >
                {tick.toFixed(axis.decimals)}
              </text>
            </g>
          ))}
          {/* 線。**間隔が空いた区間はつながない** (splitSegments)。
              測っていない 2 週間を直線で結ぶと、測ったように見えてしまう */}
          {segments.map((segment) => (
            <polyline
              key={segment[0].date}
              points={segment
                .map(
                  (point) =>
                    `${xOf(point, first.day, last.day)},${yOf(point.value, axis)}`,
                )
                .join(" ")}
              fill="none"
              stroke={LINE_COLOR}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {points.length <= MAX_DOTS &&
            points.map((point) => (
              <circle
                key={point.date}
                cx={xOf(point, first.day, last.day)}
                cy={yOf(point.value, axis)}
                r={2.5}
                fill={LINE_COLOR}
              />
            ))}
          {/* 日付。両端は内側へ寄せる (text-anchor) — 端に置くと図から出る */}
          {labelPoints(points).map((point, index, shown) => (
            <text
              key={point.date}
              x={xOf(point, first.day, last.day)}
              y={VIEW_H - 5}
              textAnchor={
                index === 0
                  ? "start"
                  : index === shown.length - 1
                    ? "end"
                    : "middle"
              }
              fontSize={9}
              fill={LABEL_COLOR}
            >
              {formatMonthDay(point.date)}
            </text>
          ))}
        </svg>
      </div>
      {(series.omitted > 0 ||
        series.otherItems.length > 0 ||
        result.omittedNotes > 0) && (
        // 黙って打ち切ると「これで全部」と読めてしまう (MatrixTable と同じ約束)
        <p className="mt-1 text-sm text-gray-500">
          {[
            series.omitted > 0 &&
              `他 ${series.omitted} 件は期間の外です(days= で伸ばせます)`,
            series.otherItems.length > 0 &&
              `他の項目: ${series.otherItems.join(" / ")}(y= で選べます)`,
            result.omittedNotes > 0 &&
              `他 ${result.omittedNotes} 件のノートは読んでいません(絞り込むと読みます)`,
          ]
            .filter((note) => note !== false)
            .join(" / ")}
        </p>
      )}
    </div>
  );
}
