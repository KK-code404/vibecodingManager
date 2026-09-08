import type { SeriesPoint } from "../../../packages/shared/src/telemetry";
import { num } from "./model";
export function ECG() {
  return (
    <svg
      viewBox="0 0 600 64"
      height="64"
      role="img"
      aria-label="遥测装饰波形，非实时指标"
    >
      <path
        d="M0 33H65l7-8 8 18 10-37 12 52 10-25h70l8-7 8 16 10-34 12 48 10-23h92l8-8 8 17 10-37 12 53 10-25h88l8-7 8 16 10-34 12 48 10-23h65"
        fill="none"
        stroke="var(--ok)"
        strokeWidth="1.5"
        opacity=".65"
      />
    </svg>
  );
}
export function ResponseChart({ series = [] }: { series?: SeriesPoint[] }) {
  const max = Math.max(100, ...series.map((p) => p.latency || 0));
  const paths: string[] = [];
  let path = "";
  series.forEach((p, i) => {
    if (p.latency === null) {
      if (path) paths.push(path);
      path = "";
      return;
    }
    const x = 40 + (i / 95) * 710,
      y = 160 - (p.latency / max) * 130;
    path += (path ? " L" : "M") + x + "," + y;
  });
  if (path) paths.push(path);
  return (
    <div className="chart">
      <svg
        viewBox="0 0 770 190"
        role="img"
        aria-label="过去 24 小时内网成功请求平均响应时间，空缺表示无样本"
      >
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line
              x1="40"
              x2="750"
              y1={160 - v * 130}
              y2={160 - v * 130}
              stroke="var(--line)"
              strokeDasharray="3 5"
            />
            <text x="0" y={164 - v * 130}>
              {Math.round(max * v)}
            </text>
          </g>
        ))}
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="var(--ok)"
            strokeWidth="1.7"
          />
        ))}
        {series.map(
          (p, i) =>
            p.latency !== null && (
              <circle
                key={i}
                cx={40 + (i / 95) * 710}
                cy={160 - (p.latency / max) * 130}
                r="2"
                fill="var(--ok)"
              >
                <title>
                  {new Date(p.at).toLocaleString()} · {num(p.latency)} ms ·{" "}
                  {p.success}/{p.total} 次成功
                </title>
              </circle>
            ),
        )}
        <text x="40" y="185">
          24h ago
        </text>
        <text x="380" y="185">
          12h
        </text>
        <text x="728" y="185">
          now
        </text>
      </svg>
      {!series.some((p) => p.latency !== null) && (
        <div className="chart-empty">暂无响应时间记录</div>
      )}
    </div>
  );
}
export function Ring({ value }: { value: number | null | undefined }) {
  return (
    <div className="ring">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="var(--line)"
          strokeWidth="6"
        />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke={value != null && value < 99 ? "var(--warn)" : "var(--ok)"}
          strokeWidth="6"
          strokeDasharray={`${(value || 0) * 2.513} 251.3`}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div>
        <b>
          {num(value, 2)}
          <small>%</small>
        </b>
        <span>样本可用率 / 24H</span>
      </div>
    </div>
  );
}
export function Spark({ values }: { values: (number | null)[] }) {
  let d = "";
  values.forEach((v, i) => {
    if (v === null) {
      d += "|";
      return;
    }
    d +=
      (d === "" || d.endsWith("|") ? "M" : "L") +
      (i / Math.max(1, values.length - 1)) * 120 +
      "," +
      (23 - (Math.min(100, v) / 100) * 21);
  });
  return (
    <svg viewBox="0 0 120 26" height="26" aria-label="资源历史">
      <line x1="0" x2="120" y1="24" y2="24" stroke="var(--line2)" />
      {d
        .split("|")
        .filter(Boolean)
        .map((p, i) => (
          <path
            key={i}
            d={p}
            fill="none"
            stroke="var(--ok)"
            strokeWidth="1.2"
          />
        ))}
    </svg>
  );
}
export function HealthGrid({ series = [] }: { series?: SeriesPoint[] }) {
  return (
    <>
      <div className="uptime">
        {Array.from({ length: 96 }, (_, i) => {
          const p = series[i];
          return (
            <i
              key={i}
              className={
                !p?.total
                  ? "none"
                  : p.success === p.total
                    ? ""
                    : p.success === 0
                      ? "d"
                      : "w"
              }
              title={
                p
                  ? `${new Date(p.at).toLocaleString()} · ${p.success}/${p.total} 次成功`
                  : "无采样"
              }
            />
          );
        })}
      </div>
      <div className="chart-legend">
        <span>24 小时前</span>
        <span>
          每格 15 分钟 · 灰色无采样 · 绿全成功 / 黄部分失败 / 红全失败
        </span>
        <span>现在</span>
      </div>
    </>
  );
}
