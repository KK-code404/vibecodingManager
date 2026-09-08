import { useState } from "react";
import type { Project } from "../../../packages/shared/src/index";
import { useDeck, go } from "./state";
import { Button, Icon, Empty } from "./ui";
import { status, cpu, fresh, hostCode, latency, num, shortTime } from "./model";
import { ECG } from "./charts";
import { ProjectActions } from "./actions";
export function ProjectCard({ project: p }: { project: Project }) {
  const { hosts, telemetry, user } = useDeck();
  const h = hosts.find((h) => h.id === p.hostId),
    s = status(p),
    t = telemetry?.projects[p.id];
  return (
    <article
      className={
        "card " +
        (s.key === "alert"
          ? "bad"
          : s.key === "stopped"
            ? "stop"
            : s.key === "undeployed"
              ? "ghost"
              : "")
      }
    >
      <div className="c-h">
        <i className={"led " + s.color} />
        <a className="nm" href={`#/project?id=${p.id}`}>
          {p.name}
        </a>
        <span className={"st " + s.color} title={s.text}>
          {s.badge}
        </span>
      </div>
      <a
        className={"url " + (s.key === "alert" ? "alert" : "")}
        href={p.publicUrl || undefined}
        target="_blank"
        rel="noreferrer"
      >
        {p.publicUrl
          ? p.publicUrl.replace(/^https?:\/\//, "")
          : "未配置公网地址"}{" "}
        ↗
      </a>
      <div className="desc">{p.description || `${p.name} · ${s.text}`}</div>
      <div className="tags">
        {p.stack
          .split(/[,，、;·+＋]/)
          .filter((s) => s.trim())
          .slice(0, 5)
          .map((s, i) => (
            <span className="tag" key={i}>
              {s.trim()}
            </span>
          ))}
      </div>
      <div className="node-label">
        {hostCode(p.hostId)} · {h?.address || "待接入"}
        {p.tcpPort ? ":" + p.tcpPort : ""}
        <span>{s.text}</span>
      </div>
      <div className="mtr">
        <div>
          响应 / ms<b>{num(latency(p))}</b>
        </div>
        <div>
          可用率 / 24h<b>{num(t?.availability, 2)}%</b>
        </div>
        <div>
          应用 CPU<b>{num(cpu(p, h), 1)}%</b>
        </div>
      </div>
      <div className="acts">
        <a className="btn" href={p.repository} target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
        {user.role !== "viewer" && (
          <Button mini onClick={() => go(`project?id=${p.id}&logs=1`)}>
            日志
          </Button>
        )}
        <span className="push" />
        <ProjectActions project={p} host={h} mini />
      </div>
      <div className="card-foot">
        LAST CHECK{" "}
        <span>{shortTime(Math.max(0, ...p.checks.map((c) => c.at)))}</span>
      </div>
    </article>
  );
}
export default function Projects({
  projectView = false,
}: {
  projectView?: boolean;
}) {
  const { projects, hosts, telemetry, refresh, user } = useDeck();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const running = projects.filter(
      (p) => p.deployment === "deployed" && p.runtime === "running",
    ).length,
    alerts = projects.filter((p) => status(p).key === "alert").length;
  const values = hosts
    .filter(fresh)
    .map((h) => h.sample?.data.host?.cpu)
    .filter((n): n is number => typeof n === "number");
  const avg = telemetry?.series.filter((p) => p.latency !== null) || [];
  const response = avg.length
    ? avg.reduce((a, p) => a + (p.latency || 0) * p.success, 0) /
      avg.reduce((a, p) => a + p.success, 0)
    : null;
  const shown = projects.filter(
    (p) =>
      (filter === "all" ||
        (filter === "running"
          ? p.deployment === "deployed" && p.runtime === "running"
          : status(p).key === filter)) &&
      [p.name, p.stack, p.publicUrl, p.description]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const filters = [
    ["all", "全部"],
    ["running", "运行中"],
    ["alert", "告警"],
    ["stopped", "已停止"],
    ["undeployed", "未部署"],
    ["unknown", "未知"],
    ["maintenance", "维护"],
  ];
  return (
    <>
      <header className="phead">
        <div>
          <h2>{projectView ? "项目目录" : "系统总览"}</h2>
          <div className="sub">
            {projectView ? "PROJECT REGISTRY" : "OPERATIONS OVERVIEW"} ·{" "}
            {projects.length} PROJECTS · SYNC {shortTime(telemetry?.at)}
          </div>
        </div>
        <div className="p-actions">
          <label className="inp">
            <Icon name="search" />
            <input
              aria-label="搜索项目"
              placeholder="搜索项目、技术栈…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <Button
            icon="refresh"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              await refresh();
              setBusy(false);
            }}
          >
            刷新
          </Button>
          {user.role === "admin" && (
            <Button kind="teal" icon="plus" onClick={() => go("add")}>
              接入项目
            </Button>
          )}
        </div>
      </header>
      {!projectView && (
        <>
          <div className="tele">
            <div className="tl">
              <div className="lab">SYSTEM TELEMETRY</div>
              <div className="sum">
                <b>{running}</b> 运行中 / {projects.length} 项目
                <br />
                <b className={alerts ? "d" : ""}>{alerts}</b> 健康异常 ·{" "}
                {hosts.length} 个节点
              </div>
            </div>
            <ECG />
            <div className="tr">
              AVAIL{" "}
              <b>
                {num(
                  telemetry?.checks
                    ? (telemetry.success / telemetry.checks) * 100
                    : null,
                  2,
                )}
                %
              </b>
              <br />
              AVG RESP <b>{num(response)} ms</b>
              <br />
              CHECKS <b>{telemetry?.checks || 0}</b>
            </div>
          </div>
          <div className="kpis">
            {[
              [
                "在线项目",
                String(running),
                "/ " + projects.length,
                "SSH 实测运行状态",
              ],
              ["平均响应", num(response), "ms", "过去 24h · 内网成功样本"],
              [
                "今日告警",
                String(telemetry?.alertsToday || 0),
                "次",
                "连续失败形成的告警事件",
              ],
              [
                "节点平均 CPU",
                num(
                  values.length
                    ? values.reduce((a, b) => a + b, 0) / values.length
                    : null,
                  1,
                ),
                "%",
                values.length
                  ? `${values.length} 个节点已采集`
                  : "等待 SSH 资源采集",
              ],
            ].map(([lab, val, unit, note]) => (
              <div className="kpi" key={lab}>
                <div className="lab">{lab}</div>
                <div className="num">
                  {val} <small>{unit}</small>
                </div>
                <div className="delta neutral">{note}</div>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="h2">
        <i />
        PROJECTS <span className="muted">/ {shown.length}</span>
        <div className="tabs">
          {filters.map(([k, l]) => (
            <button
              className={"tab " + (filter === k ? "on" : "")}
              key={k}
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="grid">
        {shown.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
        {!shown.length && <Empty>没有匹配的项目。调整搜索词或状态筛选。</Empty>}
        {user.role === "admin" && filter === "all" && !query && (
          <button className="card ghost add" onClick={() => go("add")}>
            <span className="add-mark">+</span>
            <b>接入新项目</b>
            <span>关联仓库 · 配置探测 · 纳入监控</span>
          </button>
        )}
      </div>
      <div className="page-foot">
        AUTO SYNC / 30s <span>运行状态与健康状态独立判断 · 无数据时显示 —</span>
      </div>
    </>
  );
}
