import { useEffect, useRef, useState } from "react";
import type { Project, Host } from "../../../packages/shared/src/index";
import { api } from "./api";
import { Button, Modal, Notice, useToast } from "./ui";
import { useDeck } from "./state";
import { canControl, labels, status } from "./model";
export function ProjectActions({
  project: p,
  host,
  mini = false,
}: {
  project: Project;
  host?: Host;
  mini?: boolean;
}) {
  const { user, refresh } = useDeck();
  const toast = useToast();
  const [confirm, setConfirm] = useState<"stop" | "restart" | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  if (user.role === "viewer" || p.deployment !== "deployed") return null;
  const enabled = canControl(p, host);
  async function perform(action: string) {
    setConfirm(null);
    setBusy(true);
    try {
      const r = await api<{ taskId: string }>(
        `/projects/${p.id}/actions`,
        "POST",
        { action },
      );
      toast("操作任务已提交");
      async function poll() {
        try {
          const task = await api<{ status: string; result?: string }>(
            `/tasks/${r.taskId}`,
          );
          if (!alive.current) return;
          if (["queued", "executing"].includes(task.status)) {
            timer.current = setTimeout(poll, 1500);
            return;
          }
          setBusy(false);
          toast(
            `操作${labels[task.status] || task.status}`,
            task.status === "succeeded" ? "ok" : "warn",
          );
          void refresh();
        } catch (e) {
          if (alive.current) {
            setBusy(false);
            toast("任务查询中断，请在操作记录核对结果", "warn");
          }
        }
      }
      if (alive.current) void poll();
    } catch (e) {
      if (alive.current) {
        setBusy(false);
        toast((e as Error).message, "bad");
      }
    }
  }
  return (
    <>
      <span
        className="control-actions"
        title={!enabled ? "等待 SSH 接入并核对服务映射后启用控制" : undefined}
      >
        {p.runtime === "stopped" ? (
          <Button
            mini={mini}
            kind={mini ? "on" : "teal"}
            icon="play"
            busy={busy}
            disabled={!enabled}
            onClick={() => perform("start")}
          >
            启动
          </Button>
        ) : mini ? (
          <Button
            mini
            kind={status(p).key === "alert" ? "off" : enabled ? "on" : ""}
            icon={status(p).key === "alert" ? "refresh" : undefined}
            busy={busy}
            disabled={!enabled}
            aria-label={status(p).key === "alert" ? "重启服务" : "停止"}
            title={enabled ? "点击后确认操作" : "等待 SSH 接入"}
            onClick={() =>
              setConfirm(status(p).key === "alert" ? "restart" : "stop")
            }
          >
            {status(p).key === "alert"
              ? "重启服务"
              : enabled
                ? "● 运行中"
                : "待连接"}
          </Button>
        ) : (
          <>
            <Button
              mini={mini}
              kind={mini ? "off" : "red"}
              icon="stop"
              busy={busy}
              disabled={!enabled}
              onClick={() => setConfirm("stop")}
            >
              停止
            </Button>
            {!mini && (
              <Button
                icon="refresh"
                disabled={!enabled || busy}
                onClick={() => setConfirm("restart")}
              >
                重启
              </Button>
            )}
          </>
        )}
      </span>
      {confirm && (
        <Modal
          title={confirm === "stop" ? "确认停止项目" : "确认重启项目"}
          close={() => setConfirm(null)}
        >
          <p className="desc">
            将{confirm === "stop" ? "停止" : "重启"} {p.name}{" "}
            的以下应用服务，操作可能中断业务访问。
          </p>
          <div className="tags">
            {p.controlledServices.map((s) => (
              <span className="tag" key={s}>
                {s}
              </span>
            ))}
          </div>
          <Notice>
            仅操作已存在且通过标签验证的容器。worker 超时将中止后续操作。
          </Notice>
          <div className="modal-actions">
            <Button onClick={() => setConfirm(null)}>取消</Button>
            <Button kind="red" onClick={() => perform(confirm)}>
              确认{confirm === "stop" ? "停止" : "重启"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
