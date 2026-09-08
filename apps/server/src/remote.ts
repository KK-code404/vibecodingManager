import { Client } from "ssh2";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Host } from "../../../packages/shared/src/index.ts";
import type { DB } from "./db.ts";
import { audit } from "./db.ts";
import { hosts, projects } from "./store.ts";
import { redact, resolveSafe } from "./security.ts";
export async function remote(
  host: Host,
  request: Record<string, unknown>,
  timeout = 20000,
): Promise<any> {
  if (!host.fingerprint) throw new Error("尚未配置 SSH 主机指纹");
  if (!/^[a-zA-Z0-9_-]+$/.test(host.keyRef)) throw new Error("密钥引用不合法");
  const address = await resolveSafe(host.address, true);
  let key: Buffer;
  try {
    key = readFileSync(
      join(process.env.SSH_KEY_DIR || "./data/ssh", host.keyRef),
    );
  } catch {
    throw new Error("SSH 密钥不可读取，请检查服务器密钥挂载配置");
  }
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let done = false;
    let output = "";
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      conn.end();
      if (error) reject(error);
      else {
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(new Error("远程响应格式错误"));
        }
      }
    };
    const timer = setTimeout(
      () => finish(new Error("SSH 操作超时；结果需重新核对")),
      timeout,
    );
    conn
      .on("error", () =>
        finish(new Error("SSH 连接失败，请检查连接配置与密钥")),
      )
      .on("close", () => {
        if (!done) finish(new Error("SSH 连接中断；结果需重新核对"));
      })
      .on("ready", () =>
        conn.exec("control-center", (err, stream) => {
          if (err) return finish(new Error("远程入口不可用"));
          stream.on("data", (data: Buffer) => {
            output += data.toString();
            if (Buffer.byteLength(output) > 1024 * 1024)
              finish(new Error("远程输出超出限制"));
          });
          stream.stderr.on("data", () => {});
          stream.on("close", (code: number) =>
            finish(
              code === 0
                ? undefined
                : new Error(redact(output).slice(0, 2000) || "远程操作失败"),
            ),
          );
          stream.end(JSON.stringify(request) + "\n");
        }),
      )
      .connect({
        host: address.address,
        port: host.port,
        username: host.username,
        privateKey: key,
        readyTimeout: 10000,
        algorithms: {
          serverHostKey: [
            "ssh-ed25519",
            "ecdsa-sha2-nistp256",
            "rsa-sha2-512",
            "rsa-sha2-256",
          ],
        },
        hostVerifier: (key: Buffer) =>
          `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}` ===
          host.fingerprint,
      });
  });
}
export function createRemoteService(
  db: DB,
  exec = remote,
  afterAction: () => Promise<void> = async () => {},
) {
  let collecting = false;
  const collect = async () => {
    if (collecting) return;
    collecting = true;
    try {
      for (const h of hosts(db)) {
        if (!h.fingerprint) continue;
        try {
          const data = await exec(h, { operation: "status" });
          db.prepare(
            "INSERT INTO samples(host_id,data,error,at) VALUES(?,?,?,?)",
          ).run(h.id, JSON.stringify(data), "", Date.now());
          for (const p of projects(db).filter((p) => p.hostId === h.id)) {
            const r = data.projects?.[p.remoteId];
            db.prepare(
              "UPDATE projects SET runtime=?,runtime_at=? WHERE id=?",
            ).run(r?.runtime || "unknown", Date.now(), p.id);
          }
        } catch (e) {
          db.prepare(
            "INSERT INTO samples(host_id,data,error,at) VALUES(?,?,?,?)",
          ).run(h.id, "{}", (e as Error).message, Date.now());
          db.prepare(
            "UPDATE projects SET runtime='unknown' WHERE json_extract(config,'$.hostId')=?",
          ).run(h.id);
        }
      }
    } finally {
      collecting = false;
    }
  };
  const queue = (id: number, userId: number, action: string) => {
    const p = projects(db).find((p) => p.id === id);
    if (
      !p ||
      p.deployment !== "deployed" ||
      !p.composeProject ||
      !p.controlledServices.length
    )
      throw new Error("项目尚未满足控制条件");
    const h = hosts(db).find((h) => h.id === p.hostId);
    if (!h?.fingerprint) throw new Error("请先完成 SSH 配置和连接验证");
    const sample = h.sample;
    if (!sample || sample.error || Date.now() - sample.at > 90000)
      throw new Error("SSH 状态过期，请先验证连接");
    const discovered = sample.data.projects?.[p.remoteId];
    if (
      !discovered ||
      discovered.composeProject !== p.composeProject ||
      JSON.stringify([...discovered.controlledServices].sort()) !==
        JSON.stringify([...p.controlledServices].sort())
    )
      throw new Error("远程项目映射与登记配置不一致");
    const taskId = randomUUID();
    try {
      db.prepare(
        "INSERT INTO tasks(id,project_id,user_id,action,status,created) VALUES(?,?,?,?,?,?)",
      ).run(taskId, id, userId, action, "queued", Date.now());
    } catch {
      throw new Error("该项目已有执行中的任务");
    }
    audit(db, userId, "project." + action, String(id), taskId);
    const prior = p.maintenance;
    db.prepare("UPDATE projects SET maintenance=1 WHERE id=?").run(id);
    void (async () => {
      db.prepare("UPDATE tasks SET status='executing' WHERE id=?").run(taskId);
      try {
        const result = await exec(
          h,
          { operation: action, project: p.remoteId },
          240000,
        );
        const completedAt = Date.now();
        db.prepare("UPDATE projects SET maintenance=? WHERE id=?").run(
          action === "stop" ? 1 : 0,
          id,
        );
        await afterAction();
        result.health =
          projects(db)
            .find((project) => project.id === id)
            ?.checks.filter((check) => check.at >= completedAt) || [];
        result.healthPending = result.health.length === 0;
        db.prepare(
          "UPDATE tasks SET status='succeeded',result=?,finished=? WHERE id=?",
        ).run(redact(JSON.stringify(result)), Date.now(), taskId);
      } catch (e) {
        const message = (e as Error).message;
        db.prepare("UPDATE projects SET maintenance=? WHERE id=?").run(
          +prior,
          id,
        );
        db.prepare(
          "UPDATE tasks SET status=?,result=?,finished=? WHERE id=?",
        ).run(
          /超时|中断/.test(message) ? "uncertain" : "failed",
          redact(message),
          Date.now(),
          taskId,
        );
      } finally {
        await collect();
        const t = db
          .prepare("SELECT status,result FROM tasks WHERE id=?")
          .get(taskId) as any;
        audit(
          db,
          userId,
          "project.action.result",
          String(id),
          JSON.stringify({ taskId, ...t }),
        );
      }
    })().catch(() => {});
    return taskId;
  };
  const recover = () => {
    db.prepare(
      "UPDATE tasks SET status='uncertain',result='控制中心重启，未重放操作；正在重新采集运行状态',finished=? WHERE status IN ('queued','executing')",
    ).run(Date.now());
  };
  return { collect, queue, recover };
}
