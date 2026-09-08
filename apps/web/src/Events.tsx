import { useState } from "react";
import type { ConsoleEvent } from "../../../packages/shared/src/telemetry";
import { useData, time } from "./api";
import { Box, Button, Empty, Notice, Select } from "./ui";
export default function Events() {
  const {
    data = [],
    error,
    refresh,
  } = useData<ConsoleEvent[]>("/events", 10000);
  const [level, setLevel] = useState("all");
  const [cutoff, setCutoff] = useState(0);
  const rows = data.filter(
    (e) => (level === "all" || e.level === level) && e.at > cutoff,
  );
  return (
    <>
      <header className="phead">
        <div>
          <h2>事件日志</h2>
          <div className="sub">
            EVENT STREAM · 健康检查与操作结果 · 10s SYNC
          </div>
        </div>
        <div className="p-actions">
          <Select
            aria-label="事件级别"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="all">全部级别</option>
            <option value="ok">正常</option>
            <option value="error">异常</option>
            <option value="warn">警告</option>
            <option value="info">信息</option>
          </Select>
          <Button onClick={() => setCutoff(Date.now())}>标记已读</Button>
          {cutoff > 0 && <Button onClick={() => setCutoff(0)}>显示全部</Button>}
          <Button icon="refresh" onClick={refresh}>
            刷新
          </Button>
        </div>
      </header>
      {error && <Notice error>{error}</Notice>}
      <Box title="SYSTEM EVENTS" extra={<span>{rows.length} EVENTS</span>}>
        <div className="evlog">
          {rows.length ? (
            rows.map((e) => (
              <div className="event-line" key={e.id}>
                <span className="t">{time(e.at)}</span>
                <span
                  className={
                    { ok: "ok", error: "d", warn: "w", info: "i" }[e.level]
                  }
                >
                  [{e.level.toUpperCase()}]
                </span>
                <span>{e.text}</span>
              </div>
            ))
          ) : (
            <Empty>暂无未读事件</Empty>
          )}
        </div>
      </Box>
      <div className="page-foot">
        最近 200 条事件 <span>标记已读仅影响当前视图，不删除审计记录。</span>
      </div>
    </>
  );
}
