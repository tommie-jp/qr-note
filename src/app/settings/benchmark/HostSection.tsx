// ベンチマークの「ホストとコンテナ」の節。free -m と docker stats --no-stream に
// 当たる表を、サーバの計測の前に取った値で出す (src/lib/diag/hostSnapshot.ts)
import type {
  ContainerStat,
  FreeMem,
  HostSnapshot,
  ServerBenchResult,
} from "@/lib/diag/benchTypes";
import {
  containerLabel,
  formatCpuPercent,
  formatMemUsage,
  freeMemTable,
} from "@/lib/diag/formatBench";
import { formatJstDateTimeAgo } from "@/lib/datetime";
import { CELL_CLASS, TABLE_CLASS } from "./tableClasses";

const HEAD_NUM_CLASS = `${CELL_CLASS} text-right`;
const NUM_CELL_CLASS = `${CELL_CLASS} text-right tabular-nums`;

function FreeMemTable({ mem }: { mem: FreeMem }) {
  const { head, rows } = freeMemTable(mem);
  return (
    <div className="overflow-x-auto">
      <table className={TABLE_CLASS}>
        <thead className="text-gray-500">
          <tr>
            <th className={CELL_CLASS}>free -m (単位 MiB)</th>
            {head.map((name) => (
              <th key={name} className={HEAD_NUM_CLASS}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 text-gray-800">
          {rows.map((row) => (
            <tr key={row.label}>
              <td className={CELL_CLASS}>{row.label}</td>
              {row.cells.map((value, col) => (
                <td key={head[col]} className={NUM_CELL_CLASS}>
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContainerTable({ stats }: { stats: readonly ContainerStat[] }) {
  return (
    <div className="overflow-x-auto">
      <table className={TABLE_CLASS}>
        <thead className="text-gray-500">
          <tr>
            <th className={CELL_CLASS}>コンテナ</th>
            <th className={HEAD_NUM_CLASS}>CPU %</th>
            <th className={HEAD_NUM_CLASS}>MEM USAGE / LIMIT</th>
            <th className={HEAD_NUM_CLASS}>PIDS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 text-gray-800">
          {stats.map((stat) => (
            <tr key={stat.id}>
              <td className={`${CELL_CLASS} break-all`}>{containerLabel(stat)}</td>
              <td className={NUM_CELL_CLASS}>{formatCpuPercent(stat)}</td>
              <td className={`${NUM_CELL_CLASS} whitespace-nowrap`}>
                {formatMemUsage(stat)}
              </td>
              <td className={NUM_CELL_CLASS}>{stat.pids ?? "不明"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HostTables({ host, now }: { host: HostSnapshot; now: Date | null }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        {formatJstDateTimeAgo(new Date(host.takenAt), now)} 取得 (計測の負荷を掛ける前)。
        {host.namesAt &&
          ` コンテナ名の表は ${formatJstDateTimeAgo(new Date(host.namesAt), now)} 時点 (配布で更新)。`}
      </p>
      {host.freeMem && <FreeMemTable mem={host.freeMem} />}
      {host.containers.length > 0 && <ContainerTable stats={host.containers} />}
      <p className="text-xs text-gray-500">
        free -m と docker stats --no-stream と同じ計算です。used は total − available、MEM
        USAGE はページキャッシュ (inactive_file) を除いた値、CPU % は 1 秒の平均で 1 コア =
        100% です。
      </p>
      {host.notes.map((note) => (
        <p key={note} className="text-sm text-amber-700">
          {note}
        </p>
      ))}
    </div>
  );
}

// 未計測は server が null。古い保存 (v0.23.142 まで) には host が無い
export function HostSection({
  server,
  now,
}: {
  server: ServerBenchResult | null;
  // 「5分前」の基準。描き終える前は null
  now: Date | null;
}) {
  const host = server?.host;
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold">ホストとコンテナ</h2>
      {host ? (
        <HostTables host={host} now={now} />
      ) : (
        <p className="text-sm text-gray-500">未計測 (サーバを計測すると出ます)</p>
      )}
    </section>
  );
}
