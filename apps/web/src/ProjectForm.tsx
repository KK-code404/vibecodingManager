import { useState } from "react";
import type { ProjectInput } from "../../../packages/shared/src/index";
import { api } from "./api";
import { useDeck, go } from "./state";
import { Box, Button, Empty, Field, Notice, Row, Select, useToast } from "./ui";
import { hostCode } from "./model";
const blank: ProjectInput = {
  name: "",
  stack: "",
  description: "",
  branch: "",
  exposure: "unknown",
  repository: "",
  deployment: "undeployed",
  hostId: null,
  remoteId: "",
  composeProject: "",
  directory: "",
  publicUrl: "",
  internalUrl: "",
  publicHealthUrl: "",
  tcpPort: null,
  services: [],
  controlledServices: [],
};
export default function ProjectForm({ id }: { id?: number }) {
  const { projects, hosts, user, refresh } = useDeck();
  const existing = projects.find((p) => p.id === id);
  const [p, setP] = useState<ProjectInput>(
    existing ? { ...existing } : { ...blank },
  );
  const [services, setServices] = useState(p.services.join(", "));
  const [controlled, setControlled] = useState(p.controlledServices.join(", "));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<
    { kind: string; ok: boolean; message: string }[]
  >([]);
  const toast = useToast();
  if (user.role !== "admin")
    return <Notice error>仅管理员可以管理资产配置。</Notice>;
  if (id && !existing) return <Empty>项目不存在</Empty>;
  function field<K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) {
    setP((v) => ({ ...v, [key]: value }));
    setResults([]);
  }
  const draft = {
    ...p,
    services: services
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean),
    controlledServices: controlled
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
  const host = hosts.find((h) => h.id === p.hostId);
  const ready = [
    ["基本信息", !!p.name && !!p.remoteId],
    ["仓库关联", p.repository.startsWith("https://")],
    ["部署节点", !!host],
    ["健康检查", !!p.internalUrl],
  ] as const;
  return (
    <>
      <div className="crumbs">
        <a href="#/projects">项目目录</a> / {id ? "编辑配置" : "接入项目"}
      </div>
      <header className="phead">
        <div>
          <h2>{id ? "编辑项目配置" : "接入新项目"}</h2>
          <div className="sub">PROJECT ONBOARDING · 注册资产与探测入口</div>
        </div>
        <Button onClick={() => go("projects")}>取消</Button>
      </header>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy("save");
          setError("");
          try {
            if (projects.some((x) => x.id !== id && x.name === p.name))
              throw new Error("项目名称已存在");
            await api(
              id ? `/projects/${id}` : "/projects",
              id ? "PUT" : "POST",
              draft,
            );
            await refresh();
            toast(id ? "项目配置已更新" : "项目已接入，等待首次采集");
            go("projects");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy("");
          }
        }}
      >
        <div className="flayout">
          <div>
            <section className="fsec">
              <h4>
                <i />
                01 / 基本信息
              </h4>
              <div className="fgrid">
                <Field label="项目名称 *">
                  <input
                    required
                    maxLength={100}
                    value={p.name}
                    onChange={(e) => field("name", e.target.value)}
                    placeholder="输入项目名称"
                  />
                </Field>
                <Field label="远程项目标识 *">
                  <input
                    required
                    pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}"
                    value={p.remoteId}
                    onChange={(e) => field("remoteId", e.target.value)}
                    placeholder="与 SSH 允许列表一致"
                  />
                </Field>
                <Field label="技术栈" wide>
                  <input
                    maxLength={500}
                    value={p.stack}
                    onChange={(e) => field("stack", e.target.value)}
                    placeholder="React, Node.js, Docker Compose"
                  />
                </Field>
                <Field label="项目说明" wide>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={p.description || ""}
                    onChange={(e) => field("description", e.target.value)}
                    placeholder="一句话描述项目用途"
                  />
                </Field>
              </div>
            </section>
            <section className="fsec">
              <h4>
                <i />
                02 / 源码关联
              </h4>
              <div className="fgrid">
                <Field label="GitHub 仓库 / HTTPS *">
                  <input
                    type="url"
                    required
                    value={p.repository}
                    onChange={(e) => field("repository", e.target.value)}
                    placeholder="https://github.com/owner/repository"
                  />
                </Field>
                <Field label="分支 / 仅登记">
                  <input
                    value={p.branch || ""}
                    maxLength={100}
                    onChange={(e) => field("branch", e.target.value)}
                    placeholder="未登记"
                  />
                </Field>
              </div>
              <div className="form-hint">
                仓库只读关联。接入不会拉取代码、构建镜像或部署服务。
              </div>
            </section>
            <section className="fsec">
              <h4>
                <i />
                03 / 部署配置
              </h4>
              <div className="fgrid">
                <Field label="部署状态">
                  <Select
                    value={p.deployment}
                    onChange={(e) => field("deployment", e.target.value as any)}
                  >
                    <option value="undeployed">未部署</option>
                    <option value="pending">部署待确认</option>
                    <option value="deployed">已部署</option>
                  </Select>
                </Field>
                <Field label="部署节点">
                  <Select
                    value={p.hostId || ""}
                    onChange={(e) =>
                      field("hostId", Number(e.target.value) || null)
                    }
                  >
                    <option value="">未绑定</option>
                    {hosts.map((h) => (
                      <option key={h.id} value={h.id}>
                        {hostCode(h.id)} · {h.address}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="运行方式">
                  <input value="Docker Compose" disabled />
                </Field>
                <Field label="Compose 项目名">
                  <input
                    value={p.composeProject}
                    onChange={(e) => field("composeProject", e.target.value)}
                    placeholder="使用容器标签中的真实项目名"
                  />
                </Field>
                <Field label="宿主机 TCP 端口">
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={p.tcpPort || ""}
                    onChange={(e) =>
                      field("tcpPort", Number(e.target.value) || null)
                    }
                  />
                </Field>
                <Field label="部署目录">
                  <input
                    value={p.directory}
                    onChange={(e) => field("directory", e.target.value)}
                    placeholder="/home/user/apps/project"
                  />
                </Field>
                <Field label="全部服务 / 逗号分隔" wide>
                  <input
                    value={services}
                    onChange={(e) => {
                      setServices(e.target.value);
                      setResults([]);
                    }}
                    placeholder="frontend, api, db, redis"
                  />
                </Field>
                <Field label="允许控制的应用服务 / 逗号分隔" wide>
                  <input
                    value={controlled}
                    onChange={(e) => {
                      setControlled(e.target.value);
                      setResults([]);
                    }}
                    placeholder="frontend, api"
                  />
                </Field>
                <Field label="公网地址">
                  <input
                    type="url"
                    value={p.publicUrl}
                    onChange={(e) => field("publicUrl", e.target.value)}
                    placeholder="https://app.example.com"
                  />
                </Field>
                <Field label="Cloudflare 接入 / 仅登记">
                  <Select
                    value={p.exposure || "unknown"}
                    onChange={(e) => field("exposure", e.target.value as any)}
                  >
                    <option value="unknown">未登记</option>
                    <option value="tunnel">Cloudflare Tunnel</option>
                    <option value="dns">DNS / 代理</option>
                  </Select>
                </Field>
              </div>
              <div className="form-hint">
                服务映射还需在 VM 的 root
                允许列表中配置。未核对归属前不开放启停。
              </div>
            </section>
            <section className="fsec">
              <h4>
                <i />
                04 / 健康检查
              </h4>
              <div className="fgrid">
                <Field label="内网 HTTP 健康地址" wide>
                  <input
                    type="url"
                    value={p.internalUrl}
                    onChange={(e) => field("internalUrl", e.target.value)}
                    placeholder={
                      host
                        ? `http://${host.address}:${p.tcpPort || "端口"}/api/health`
                        : "先选择节点"
                    }
                  />
                </Field>
                <Field label="公网 HTTP 健康地址" wide>
                  <input
                    type="url"
                    value={p.publicHealthUrl}
                    onChange={(e) => field("publicHealthUrl", e.target.value)}
                    placeholder="https://app.example.com/api/health"
                  />
                </Field>
                <Field label="检查周期">
                  <input disabled value="30 秒" />
                </Field>
                <Field label="超时 / 告警阈值">
                  <input disabled value="5 秒 / 连续 3 次失败" />
                </Field>
              </div>
              <div className="form-hint">
                仅允许登记主机与公网域名；HTTP 2xx 为成功，不跟随重定向。
              </div>
            </section>
            {error && <Notice error>{error}</Notice>}
            <div className="form-actions">
              <Button
                busy={busy === "test"}
                disabled={!!busy}
                icon="pulse"
                onClick={async () => {
                  setBusy("test");
                  setError("");
                  try {
                    const r = await api<{ checks: typeof results }>(
                      "/projects/test",
                      "POST",
                      draft,
                    );
                    setResults(r.checks);
                    toast(
                      "测试完成，请查看连接检查结果",
                      r.checks.every((c) => c.ok) ? "ok" : "warn",
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                测试连接
              </Button>
              <Button
                type="submit"
                kind="teal"
                icon="check"
                busy={busy === "save"}
                disabled={!!busy}
              >
                {id ? "保存配置" : "确认接入"}
              </Button>
            </div>
          </div>
          <aside className="fprev">
            <Box title="实时预览 / LIVE PREVIEW">
              <div className="preview-card">
                <div className="c-h">
                  <i className="led gray" />
                  <b>{p.name || "项目名称"}</b>
                  <span className="st">NEW</span>
                </div>
                <div className="url">{p.publicUrl || "尚未配置域名"}</div>
                <p className="desc">
                  {p.description || "项目说明将在这里显示"}
                </p>
                <div className="tags">
                  {p.stack
                    .split(/[,，、;·+＋]/)
                    .filter(Boolean)
                    .slice(0, 4)
                    .map((s, i) => (
                      <span className="tag" key={i}>
                        {s.trim()}
                      </span>
                    ))}
                </div>
                <div className="node-label">
                  {hostCode(p.hostId)} · {p.tcpPort || "—"}
                </div>
                <div className="mtr">
                  <div>
                    响应<b>—</b>
                  </div>
                  <div>
                    可用率<b>—</b>
                  </div>
                  <div>
                    CPU<b>—</b>
                  </div>
                </div>
              </div>
            </Box>
            <Box title="接入检查 / CHECKLIST" className="section-gap">
              {ready.map(([name, ok]) => (
                <Row key={name} label={name}>
                  <span className={ok ? "ok-text" : "muted"}>
                    {ok
                      ? "✓ 已填写"
                      : p.deployment !== "deployed" &&
                          ["部署节点", "健康检查"].includes(name)
                        ? "未部署 / 可稍后配置"
                        : "待填写"}
                  </span>
                </Row>
              ))}
              {results.map((r) => (
                <Row
                  key={r.kind}
                  label={r.kind === "ssh" ? "SSH 连接" : "HTTP 检查"}
                >
                  <span className={r.ok ? "ok-text" : "bad-text"}>
                    {r.message}
                  </span>
                </Row>
              ))}
            </Box>
            <div className="preview-note">
              预览不代表实际运行状态。保存后由健康探测与 SSH 采集产生真实指标。
            </div>
          </aside>
        </div>
      </form>
    </>
  );
}
