import { useState } from "react";
import type { Host } from "../../../packages/shared/src/index";
import { api, useData, time } from "./api";
import { useDeck } from "./state";
import { Box, Button, Empty, Notice, Row, Select, useToast } from "./ui";
import { fresh, hostCode, num } from "./model";
import { HealthGrid, Spark } from "./charts";
function HostCard({ host: h, hours }: { host: Host; hours: number }) {
  const { data = [] } = useData<any[]>(`/hosts/${h.id}/history`);
  const current = fresh(h) ? h.sample?.data.host : null;
  const samples = [...data]
    .filter((s) => s.at > Date.now() - hours * 3600000)
    .reverse();
  return (
    <section className="vmc">
      <div className="vh">
        <i className={"led " + (current ? "" : "gray")} />
        {hostCode(h.id)}{" "}
        <span className="push muted">{current ? "ONLINE" : "UNKNOWN"}</span>
      </div>
      <div className="vip">
        {h.name} · {h.address}:{h.port}
      </div>
      {[
        ["CPU", "cpu"],
        ["RAM", "memoryPercent"],
        ["DISK", "diskPercent"],
      ].map(([label, key]) => (
        <div className="mr" key={key}>
          <span className="k">{label}</span>
          <Spark
            values={samples.map((s) =>
              s.error
                ? null
                : typeof s.data?.host?.[key] === "number"
                  ? s.data.host[key]
                  : null,
            )}
          />
          <span className="v">{num(current?.[key], 1)}%</span>
        </div>
      ))}
      <div className="proc">
        LAST SYNC <b>{h.sample ? time(h.sample.at) : "等待首次采集"}</b>
        <br />
        {h.sample?.error ? (
          <span className="bad-text">{h.sample.error}</span>
        ) : !current ? (
          "SSH 未接入或数据过期"
        ) : (
          "同一节点共享一份资源采样"
        )}
      </div>
    </section>
  );
}
export default function Monitor() {
  const { hosts, telemetry, refresh, user } = useDeck();
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <>
      <header className="phead">
        <div>
          <h2>节点监控</h2>
          <div className="sub">
            INFRASTRUCTURE · {hosts.length} NODES · 30s INTERVAL
          </div>
        </div>
        <div className="p-actions">
          <Select
            aria-label="资源历史范围"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            <option value={1}>最近 1 小时</option>
            <option value={6}>最近 6 小时</option>
            <option value={24}>最近 24 小时</option>
          </Select>
          <Button
            icon="refresh"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (user.role === "admin") await api("/hosts/collect", "POST");
                await refresh();
                toast(
                  user.role === "admin"
                    ? "节点采集已完成，请检查各节点结果"
                    : "监控数据已刷新",
                );
              } catch (e) {
                toast((e as Error).message, "bad");
              } finally {
                setBusy(false);
              }
            }}
          >
            {user.role === "admin" ? "立即采集" : "刷新"}
          </Button>
        </div>
      </header>
      <div className="vmgrid">
        {hosts.map((h) => (
          <HostCard key={h.id} host={h} hours={hours} />
        ))}
        {!hosts.length && <Empty>尚未登记节点，请在设置中添加。</Empty>}
      </div>
      <Box
        title="全局健康 / LAST 24 HOURS"
        extra={<span>{telemetry?.checks || 0} CHECKS</span>}
      >
        <HealthGrid series={telemetry?.series} />
        <Notice>
          仅统计内网 HTTP
          检查。没有采样的时间段保持灰色，公网异常可在项目详情单独查看。
        </Notice>
      </Box>
      <div className="cols2 section-gap">
        <Box title="健康告警规则 / ACTIVE RULES">
          <Row label="健康探测">30 秒 / 次 · 5 秒超时</Row>
          <Row label="异常展示">首次失败立即标红</Row>
          <Row label="失败通知">连续 3 次失败</Row>
          <Row label="恢复通知">连续 2 次成功</Row>
          <Row label="维护抑制">主动停机 / 维护中</Row>
        </Box>
        <Box title="资源观察 / OBSERVABILITY">
          <Row label="CPU / 内存 / 磁盘">监控采样 · 未配置阈值告警</Row>
          <Row label="明细保留">7 天</Row>
          <Row label="数据过期">90 秒后显示未知</Row>
          <div className="desc section-gap">
            控制中心与业务共用节点。节点离线时需通过独立外部监控检测控制中心可用性。
          </div>
        </Box>
      </div>
    </>
  );
}
