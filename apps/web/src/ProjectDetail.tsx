import { useEffect, useState } from "react";
import { api, useData, time } from "./api";
import { useDeck, go } from "./state";
import {
  Box,
  Button,
  Empty,
  Notice,
  Row,
  Select,
  Switch,
  useToast,
} from "./ui";
import { cpu, fresh, hostCode, labels, latency, num, status } from "./model";
import { ResponseChart, Ring } from "./charts";
import { ProjectActions } from "./actions";
function Logs({ id, services }: { id: number; services: string[] }) {
  const [service, setService] = useState(services[0] || "");
  const [paused, setPaused] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!service || paused) return;
    let active = true;
    const read = () =>
      api<{ text: string }>(
        `/projects/${id}/logs?service=${encodeURIComponent(service)}&lines=50`,
      )
        .then((r) => {
          if (active) {
            setText(r.text.split("\n").slice(-50).join("\n"));
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void read();
    const timer = setInterval(read, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, service, paused]);
  return (
    <Box
      title="实时日志 / LAST 50 LINES"
      extra={
        <div className="p-actions">
          <Select
            aria-label="日志服务"
            value={service}
            onChange={(e) => {
              setService(e.target.value);
              setText("");
              setError("");
            }}
          >
            {services.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <Button mini onClick={() => setPaused(!paused)}>
            {paused ? "继续" : "暂停"}
          </Button>
        </div>
      }
    >
      {error ? (
        <Notice error>{error}</Notice>
      ) : text ? (
        <pre className="log-output">
          {text.split("\n").map((line, i) => (
            <div
              className={
                /error|exception|fatal/i.test(line)
                  ? "bad-text"
                  : /warn/i.test(line)
                    ? "warn-text"
                    : ""
              }
              key={i}
            >
              {line || " "}
            </div>
          ))}
        </pre>
      ) : (
        <Empty>暂无日志，等待 SSH 读取。</Empty>
      )}
      <div className="muted">
        {paused ? "已暂停拉取" : "每 10 秒读取"} · 凭据脱敏 ·
        关键字高亮不参与健康判断
      </div>
    </Box>
  );
}
function Tasks({ id }: { id: number }) {
  const { data, error } = useData<any[]>("/tasks", 5000);
  const rows = data?.filter((t) => t.project_id === id).slice(0, 8) || [];
  return (
    <Box title="操作记录 / RECENT ACTIONS">
      {error && <Notice error>{error}</Notice>}
      {!rows.length ? (
        <Empty>暂无启停操作</Empty>
      ) : (
        rows.map((t) => (
          <div className="task-row" key={t.id}>
            <span className="muted">{time(t.created)}</span>
            <b>
              {
                ({ start: "启动", stop: "停止", restart: "重启" } as any)[
                  t.action
                ]
              }{" "}
              · {labels[t.status] || t.status}
            </b>
            <span>
              任务 #{t.id} / 用户 #{t.user_id}
            </span>
            {t.result && (
              <details>
                <summary>执行结果</summary>
                <pre>
                  {typeof t.result === "string"
                    ? t.result
                    : JSON.stringify(t.result, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ))
      )}
    </Box>
  );
}
export default function ProjectDetail({ id }: { id: number }) {
  const { projects, hosts, telemetry, user, refresh } = useDeck();
  const p = projects.find((p) => p.id === id);
  const toast = useToast();
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(location.hash.split("?")[1]).get("logs") === "1")
      document
        .getElementById("service-logs")
        ?.scrollIntoView({ block: "start" });
  }, [id]);
  if (!p)
    return (
      <Empty>
        未找到项目。<a href="#/projects">返回项目目录</a>
      </Empty>
    );
  const h = hosts.find((h) => h.id === p.hostId),
    s = status(p),
    t = telemetry?.projects[id],
    remote = fresh(h) ? h?.sample?.data.projects?.[p.remoteId] : null;
  return (
    <>
      <div className="crumbs">
        <a href="#/home">总览</a> / <a href="#/projects">项目</a> / {p.name}
      </div>
      <header className="dhead">
        <i className={"led " + s.color} />
        <span className="nm">{p.name}</span>
        <span className={"status-chip " + s.color}>{s.text}</span>
        <span className="push" />
        {user.role === "admin" && (
          <Button icon="gear" onClick={() => go(`add?id=${id}`)}>
            编辑配置
          </Button>
        )}
        <ProjectActions project={p} host={h} />
      </header>
      <div className="detail-links">
        <a href={p.publicUrl || undefined} target="_blank" rel="noreferrer">
          {p.publicUrl || "未配置公网地址"} ↗
        </a>
        <a href={p.repository} target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
        <span>{p.stack}</span>
      </div>
      <div className="tiles">
        {[
          ["当前响应", num(latency(p)), "ms", "内网 HTTP · 最近检查"],
          [
            "P95 / P99",
            `${num(t?.p95)} / ${num(t?.p99)}`,
            "ms",
            "24 小时成功请求",
          ],
          ["应用 CPU", num(cpu(p, h), 1), "%", "受控容器使用率之和"],
          [
            "运行状态",
            labels[p.runtime] || p.runtime,
            "",
            p.runtimeAt ? time(p.runtimeAt) : "等待 SSH 状态采集",
          ],
        ].map(([lab, val, unit, note]) => (
          <div className="tile" key={lab}>
            <div className="lab">{lab}</div>
            <div className="val">
              {val} <small>{unit}</small>
            </div>
            <div className="ex">{note}</div>
          </div>
        ))}
      </div>
      <div className="cols2">
        <Box title="响应时间 / RESPONSE TIME" extra={<span>24H · ms</span>}>
          <ResponseChart series={t?.series} />
          <div className="chart-stats">
            <span>
              AVG <b>{num(t?.average)} ms</b>
            </span>
            <span>
              P95 <b>{num(t?.p95)} ms</b>
            </span>
            <span>
              P99 <b>{num(t?.p99)} ms</b>
            </span>
            <span>
              SAMPLES <b>{t?.total || 0}</b>
            </span>
          </div>
          <div className="check-list">
            {p.checks.length ? (
              p.checks.map((c) => (
                <Row key={c.kind} label={labels[c.kind]}>
                  <span
                    className={
                      Date.now() - c.at > 90000
                        ? "muted"
                        : c.ok
                          ? "ok-text"
                          : "bad-text"
                    }
                  >
                    {Date.now() - c.at > 90000
                      ? "数据过期"
                      : c.ok
                        ? "正常"
                        : c.error || "异常"}
                  </span>{" "}
                  · {c.statusCode || "—"} · {num(c.latency)} ms{" "}
                  <small>{time(c.at)}</small>
                </Row>
              ))
            ) : (
              <Empty>等待首次健康检查</Empty>
            )}
          </div>
        </Box>
        <Box title="可用性与部署 / DEPLOYMENT">
          <Ring value={t?.availability} />
          <Row label="最大观测故障时长">
            {t?.maxOutage == null ? "—" : num(t.maxOutage / 1000) + " s"}
          </Row>
          <Row label="部署节点">
            {hostCode(p.hostId)} · {h?.address || "未绑定"}
          </Row>
          <Row label="端口映射">{p.tcpPort || "—"}</Row>
          <Row label="Compose 项目">{p.composeProject || "未配置"}</Row>
          <Row label="部署目录">{p.directory || "未登记"}</Row>
          <Row label="代码分支">{p.branch || "未登记"}</Row>
          <Row label="维护模式">
            <Switch
              label="维护模式"
              checked={p.maintenance}
              disabled={user.role === "viewer" || maintenanceBusy}
              onChange={async (enabled) => {
                setMaintenanceBusy(true);
                try {
                  await api(`/projects/${id}/maintenance`, "POST", { enabled });
                  await refresh();
                  toast(enabled ? "已启用维护抑制" : "已恢复健康告警");
                } catch (e) {
                  toast((e as Error).message, "bad");
                } finally {
                  setMaintenanceBusy(false);
                }
              }}
            />
          </Row>
        </Box>
      </div>
      <Box title="服务状态 / CONTAINERS" className="section-gap">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>服务</th>
                <th>状态</th>
                <th>健康</th>
                <th>CPU</th>
                <th>内存</th>
                <th>重启次数</th>
                <th>控制范围</th>
              </tr>
            </thead>
            <tbody>
              {p.services.map((name) => {
                const service = remote?.services?.find(
                  (s: any) => s.service === name,
                );
                return (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{service?.state || "未知"}</td>
                    <td>{service?.health || "—"}</td>
                    <td>{service?.cpu || "—"}</td>
                    <td>{service?.memory || "—"}</td>
                    <td>{service?.restarts ?? "—"}</td>
                    <td>
                      {p.controlledServices.includes(name)
                        ? "应用服务"
                        : "只监控"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!remote && (
          <div className="muted">
            SSH 数据尚未采集或已过期，启停入口暂不可用。
          </div>
        )}
      </Box>
      {user.role !== "viewer" ? (
        <div className="cols2 section-gap" id="service-logs">
          <Logs id={id} services={p.services} />
          <Tasks id={id} />
        </div>
      ) : (
        <Notice>
          只读角色可查看健康和资源。业务日志与启停记录需要操作员权限。
        </Notice>
      )}
    </>
  );
}
