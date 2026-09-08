import type { Project, Host } from "../../../packages/shared/src/index";
export const labels: Record<string, string> = {
  pending: "待确认",
  undeployed: "未部署",
  deployed: "已部署",
  unknown: "未知",
  running: "运行中",
  partial: "部分运行",
  stopped: "已停止",
  admin: "管理员",
  operator: "操作员",
  viewer: "只读用户",
  internal: "内网 HTTP",
  public: "公网 HTTP",
  tcp: "TCP 端口",
  queued: "排队中",
  executing: "执行中",
  succeeded: "成功",
  failed: "失败",
  uncertain: "结果待核对",
  timeout: "超时",
};
export function status(p: Project) {
  if (p.deployment === "undeployed")
    return {
      key: "undeployed",
      text: "未部署",
      badge: "GITHUB",
      color: "gray",
    };
  if (p.deployment === "pending")
    return { key: "unknown", text: "部署待确认", badge: "NEW", color: "gray" };
  if (p.runtime === "stopped")
    return { key: "stopped", text: "已停止", badge: "STOPPED", color: "gray" };
  if (p.maintenance)
    return {
      key: "maintenance",
      text: "维护中",
      badge: "MAINTENANCE",
      color: "warn",
    };
  if (p.checks.some((c) => Date.now() - c.at < 90000 && !c.ok))
    return {
      key: "alert",
      text:
        p.checks.find((c) => c.kind === "internal")?.ok &&
        p.checks.find((c) => c.kind === "public")?.ok === false
          ? "公网访问异常"
          : "健康异常",
      badge: "ALERT",
      color: "bad",
    };
  if (p.runtime === "running")
    return { key: "running", text: "运行中", badge: "PROD", color: "ok" };
  return {
    key: "unknown",
    text: p.runtime === "partial" ? "部分运行" : "运行未知",
    badge: p.runtime === "partial" ? "PARTIAL" : "UNKNOWN",
    color: p.runtime === "partial" ? "warn" : "gray",
  };
}
export function fresh(host?: Host) {
  return (
    !!host?.sample && !host.sample.error && Date.now() - host.sample.at < 90000
  );
}
export function canControl(p: Project, h?: Host) {
  const r = h?.sample?.data.projects?.[p.remoteId];
  return (
    p.deployment === "deployed" &&
    fresh(h) &&
    r?.composeProject === p.composeProject &&
    JSON.stringify([...(r?.controlledServices || [])].sort()) ===
      JSON.stringify([...p.controlledServices].sort()) &&
    p.controlledServices.length > 0
  );
}
export const hostCode = (id: number | null) =>
  id ? "VM-" + String(id).padStart(2, "0") : "未绑定 VM";
export const num = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : v.toFixed(digits);
export const shortTime = (v: number | null | undefined) =>
  v ? new Date(v).toLocaleTimeString("zh-CN", { hour12: false }) : "--:--:--";
export function cpu(p: Project, h?: Host) {
  if (!fresh(h)) return null;
  const services = h?.sample?.data.projects?.[p.remoteId]?.services || [];
  const values = services
    .filter((s: any) => p.controlledServices.includes(s.service))
    .map((s: any) => parseFloat(s.cpu))
    .filter(Number.isFinite);
  return values.length
    ? values.reduce((a: number, b: number) => a + b, 0)
    : null;
}
export function latency(p: Project) {
  const c = p.checks.find((c) => c.kind === "internal");
  return c?.ok && Date.now() - c.at < 90000 ? c.latency : null;
}
