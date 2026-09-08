import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import type { DB } from "./db.ts";
import { audit } from "./db.ts";
import { hosts, projects } from "./store.ts";
import {
  projectSchema,
  hostSchema,
  roleSchema,
  actionSchema,
} from "../../../packages/shared/src/index.ts";
import type { User } from "../../../packages/shared/src/index.ts";
import { tokenHash, resolveSafe, redact } from "./security.ts";
import { validateProject } from "./monitor.ts";
import { telemetry, events } from "./telemetry.ts";
import { safeHttp } from "./security.ts";
import { createRemoteService, remote } from "./remote.ts";
declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
    csrf: string | null;
  }
}
const userFields = "id,username,role,disabled";
const username = z.string().regex(/^[a-zA-Z0-9_.-]{3,64}$/);
const password = z.string().min(12).max(128);
export async function buildApp(
  db: DB,
  options: {
    secure?: boolean;
    origin?: string;
    remoteService?: ReturnType<typeof createRemoteService>;
  } = {},
) {
  const secure = options.secure ?? process.env.COOKIE_SECURE !== "false";
  const origin =
    options.origin || process.env.APP_ORIGIN || "http://localhost:5176";
  const app = Fastify({
    logger: {
      redact: [
        "req.headers.cookie",
        "req.headers.authorization",
        "req.body.password",
      ],
    },
    bodyLimit: 65536,
  });
  const rs = options.remoteService || createRemoteService(db);
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  app.decorateRequest("user", null);
  app.decorateRequest("csrf", null);
  const fail = (status: number, message: string) =>
    Object.assign(new Error(message), { statusCode: status });
  const admin = (req: any) => {
    if (req.user?.role !== "admin") throw fail(403, "需要管理员权限");
  };
  const operator = (req: any) => {
    if (!["admin", "operator"].includes(req.user?.role))
      throw fail(403, "需要操作员权限");
  };
  const id = (req: any) =>
    z.coerce.number().int().positive().parse(req.params.id);
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (secure) reply.header("Strict-Transport-Security", "max-age=31536000");
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    if (path === "/api/health") return;
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (mutating && req.headers.origin !== origin)
      throw fail(403, "请求来源不匹配");
    if (path === "/api/auth/login") return;
    const session = req.cookies.sid
      ? (db
          .prepare(
            `SELECT u.${userFields.split(",").join(",u.")},s.csrf FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.disabled=0`,
          )
          .get(tokenHash(req.cookies.sid), Date.now()) as any)
      : null;
    if (!session) throw fail(401, "请先登录");
    req.user = session;
    req.csrf = session.csrf;
    if (mutating && req.headers["x-csrf-token"] !== session.csrf)
      throw fail(403, "CSRF 校验失败");
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ message: error.issues.map((i) => i.message).join("；") });
    const e = error as Error & { statusCode?: number };
    if (!e.statusCode) app.log.error({ err: e }, "Request failed");
    reply.code(e.statusCode || 500).send({
      message: e.statusCode ? e.message : "操作失败，请检查配置或服务器日志",
    });
  });
  app.get("/api/health", () => ({ status: "ok" }));
  const dummy = await argon2.hash(randomBytes(32), { type: argon2.argon2id });
  // Bound memory-intensive password verification independently of IP rate limits.
  let verifyingPasswords = 0;
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const b = z
        .object({ username, password: z.string().max(128) })
        .parse(req.body);
      const u = db
        .prepare("SELECT * FROM users WHERE username=?")
        .get(b.username) as any;
      if (verifyingPasswords >= 2) throw fail(429, "登录请求较多，请稍后重试");
      verifyingPasswords++;
      let valid = false;
      try {
        valid = await argon2.verify(u?.password || dummy, b.password);
      } finally {
        verifyingPasswords--;
      }
      if (!u || !valid || u.disabled) throw fail(401, "用户名或密码错误");
      const token = randomBytes(32).toString("hex"),
        csrf = randomBytes(32).toString("hex");
      db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
        tokenHash(token),
        u.id,
        csrf,
        Date.now() + 8 * 3600000,
      );
      reply.setCookie("sid", token, {
        path: "/",
        httpOnly: true,
        secure,
        sameSite: "strict",
        maxAge: 8 * 3600,
      });
      audit(db, u.id, "auth.login", String(u.id));
      return {
        user: {
          id: u.id,
          username: u.username,
          role: u.role,
          disabled: u.disabled,
        },
        csrf,
      };
    },
  );
  app.get("/api/auth/me", (req) => ({ user: req.user, csrf: req.csrf }));
  app.post("/api/auth/logout", async (req, reply) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(
      tokenHash(req.cookies.sid || ""),
    );
    reply.clearCookie("sid", { path: "/" });
    return { ok: true };
  });
  app.get("/api/projects", () => projects(db));
  app.get("/api/telemetry", () => telemetry(db));
  app.get("/api/events", (req) => events(db, req.user?.role !== "viewer"));
  app.post(
    "/api/projects/test",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (req) => {
      admin(req);
      const p = projectSchema.parse(req.body);
      try {
        await validateProject(db, p);
      } catch (e) {
        throw fail(400, (e as Error).message);
      }
      const h = hosts(db).find((h) => h.id === p.hostId);
      const checks = await Promise.all([
        (async () => {
          try {
            if (!p.internalUrl)
              return { kind: "health", ok: false, message: "尚未配置健康地址" };
            const code = await safeHttp(p.internalUrl, true);
            return {
              kind: "health",
              ok: code >= 200 && code < 300,
              message: "HTTP " + code,
            };
          } catch (e) {
            return { kind: "health", ok: false, message: (e as Error).message };
          }
        })(),
        (async () => {
          try {
            if (!h?.fingerprint)
              return { kind: "ssh", ok: false, message: "SSH 指纹尚未配置" };
            await remote(h, { operation: "status" });
            return { kind: "ssh", ok: true, message: "SSH 连接通过" };
          } catch (e) {
            return { kind: "ssh", ok: false, message: (e as Error).message };
          }
        })(),
      ]);
      return { checks };
    },
  );
  app.post(
    "/api/hosts/collect",
    { config: { rateLimit: { max: 4, timeWindow: "1 minute" } } },
    async (req) => {
      admin(req);
      await rs.collect();
      return hosts(db);
    },
  );
  app.post("/api/projects", async (req) => {
    admin(req);
    const p = projectSchema.parse(req.body);
    await validateProject(db, p);
    if (
      projects(db).some(
        (x) => x.hostId === p.hostId && x.remoteId === p.remoteId,
      )
    )
      throw fail(409, "该主机已登记相同远程项目");
    const r = db
      .prepare("INSERT INTO projects(config) VALUES(?)")
      .run(JSON.stringify(p));
    audit(db, req.user!.id, "project.create", String(r.lastInsertRowid));
    return { id: Number(r.lastInsertRowid) };
  });
  app.put("/api/projects/:id", async (req) => {
    admin(req);
    const n = id(req);
    const previous = projects(db).find((p) => p.id === n);
    if (!previous) throw fail(404, "项目不存在");
    if (
      db
        .prepare(
          "SELECT id FROM tasks WHERE project_id=? AND status IN ('queued','executing')",
        )
        .get(n)
    )
      throw fail(409, "任务执行中，不能修改");
    const p = projectSchema.parse(req.body);
    await validateProject(db, p);
    if (
      projects(db).some(
        (x) => x.id !== n && x.hostId === p.hostId && x.remoteId === p.remoteId,
      )
    )
      throw fail(409, "重复的远程项目");
    const changed = (keys: (keyof typeof p)[]) =>
      keys.some(
        (key) => JSON.stringify(previous[key]) !== JSON.stringify(p[key]),
      );
    const healthChanged = changed([
      "hostId",
      "deployment",
      "internalUrl",
      "publicHealthUrl",
      "tcpPort",
    ]);
    const runtimeChanged = changed([
      "hostId",
      "deployment",
      "remoteId",
      "composeProject",
      "services",
      "controlledServices",
    ]);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE projects SET config=? WHERE id=?").run(
        JSON.stringify(p),
        n,
      );
      if (runtimeChanged)
        db.prepare(
          "UPDATE projects SET runtime='unknown',runtime_at=NULL WHERE id=?",
        ).run(n);
      if (healthChanged) {
        db.prepare("DELETE FROM checks WHERE project_id=?").run(n);
        db.prepare("DELETE FROM incidents WHERE project_id=?").run(n);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    audit(db, req.user!.id, "project.update", String(n));
    return { ok: true };
  });
  app.get("/api/projects/:id/history", (req) =>
    db
      .prepare(
        "SELECT kind,ok,status_code AS statusCode,latency,error,at FROM (SELECT * FROM checks WHERE project_id=? ORDER BY id DESC LIMIT 720) ORDER BY at",
      )
      .all(id(req)),
  );
  app.post("/api/projects/:id/maintenance", (req) => {
    operator(req);
    const n = id(req);
    const b = z.object({ enabled: z.boolean() }).parse(req.body);
    if (
      db
        .prepare(
          "SELECT id FROM tasks WHERE project_id=? AND status IN ('queued','executing')",
        )
        .get(n)
    )
      throw fail(409, "任务执行中，不能修改维护状态");
    db.prepare("UPDATE projects SET maintenance=? WHERE id=?").run(
      +b.enabled,
      n,
    );
    db.prepare(
      "UPDATE incidents SET active=0,failures=0,successes=0 WHERE project_id=?",
    ).run(n);
    audit(
      db,
      req.user!.id,
      "project.maintenance",
      String(n),
      String(b.enabled),
    );
    return { ok: true };
  });
  app.post("/api/projects/:id/actions", async (req, reply) => {
    operator(req);
    const b = actionSchema.parse(req.body);
    try {
      const taskId = rs.queue(id(req), req.user!.id, b.action);
      return reply.code(202).send({ taskId });
    } catch (e) {
      throw fail(409, (e as Error).message);
    }
  });
  app.get("/api/projects/:id/logs", async (req) => {
    operator(req);
    const p = projects(db).find((p) => p.id === id(req));
    if (!p) throw fail(404, "项目不存在");
    const q = z
      .object({
        service: z.string(),
        lines: z.coerce.number().int().min(1).max(1000).default(200),
      })
      .parse(req.query);
    if (!p.services.includes(q.service)) throw fail(400, "未知服务");
    const h = hosts(db).find((h) => h.id === p.hostId);
    if (!h) throw fail(409, "尚未配置主机");
    try {
      const r = await remote(h, {
        operation: "logs",
        project: p.remoteId,
        ...q,
      });
      audit(db, req.user!.id, "project.logs", String(p.id), q.service);
      return { text: redact(r.text || "") };
    } catch (e) {
      throw fail(502, (e as Error).message);
    }
  });
  app.get("/api/tasks", (req) => {
    operator(req);
    return db
      .prepare("SELECT * FROM tasks ORDER BY created DESC LIMIT 100")
      .all();
  });
  app.get("/api/tasks/:taskId", (req) => {
    operator(req);
    const t = db
      .prepare("SELECT * FROM tasks WHERE id=?")
      .get((req.params as any).taskId);
    if (!t) throw fail(404, "任务不存在");
    return t;
  });
  app.get("/api/hosts", (req) => {
    const all = hosts(db);
    return req.user?.role === "admin"
      ? all
      : all.map(({ keyRef, fingerprint, username, ...h }) => h);
  });
  app.post("/api/hosts", async (req) => {
    admin(req);
    const h = hostSchema.parse(req.body);
    await resolveSafe(h.address, true);
    const r = db
      .prepare("INSERT INTO hosts(config) VALUES(?)")
      .run(JSON.stringify(h));
    audit(db, req.user!.id, "host.create", String(r.lastInsertRowid));
    return { id: Number(r.lastInsertRowid) };
  });
  app.put("/api/hosts/:id", async (req) => {
    admin(req);
    const h = hostSchema.parse(req.body);
    await resolveSafe(h.address, true);
    const n = id(req);
    if (
      projects(db).some(
        (p) =>
          p.hostId === n &&
          p.internalUrl &&
          new URL(p.internalUrl).hostname !== h.address,
      )
    )
      throw fail(409, "已有项目绑定此主机地址，请新增主机后迁移项目");
    db.prepare("UPDATE hosts SET config=? WHERE id=?").run(
      JSON.stringify(h),
      n,
    );
    db.prepare("DELETE FROM samples WHERE host_id=?").run(n);
    audit(db, req.user!.id, "host.update", String(n));
    return { ok: true };
  });
  app.post("/api/hosts/:id/verify", async (req) => {
    admin(req);
    const h = hosts(db).find((h) => h.id === id(req));
    if (!h) throw fail(404, "主机不存在");
    try {
      const data = await remote(h, { operation: "status" });
      db.prepare(
        "INSERT INTO samples(host_id,data,error,at) VALUES(?,?,?,?)",
      ).run(h.id, JSON.stringify(data), "", Date.now());
      audit(db, req.user!.id, "host.verify", String(h.id));
      return data;
    } catch (e) {
      throw fail(502, (e as Error).message);
    }
  });
  app.get("/api/hosts/:id/history", (req) =>
    db
      .prepare(
        "SELECT data,error,at FROM samples WHERE host_id=? ORDER BY id DESC LIMIT 2880",
      )
      .all(id(req))
      .map((r: any) => ({ ...r, data: JSON.parse(r.data) })),
  );
  app.get("/api/users", (req) => {
    admin(req);
    return db.prepare(`SELECT ${userFields} FROM users ORDER BY id`).all();
  });
  app.post("/api/users", async (req) => {
    admin(req);
    const b = z
      .object({ username, password, role: roleSchema })
      .parse(req.body);
    if (db.prepare("SELECT id FROM users WHERE username=?").get(b.username))
      throw fail(409, "用户名已存在");
    const hash = await argon2.hash(b.password, { type: argon2.argon2id });
    const r = db
      .prepare("INSERT INTO users(username,password,role) VALUES(?,?,?)")
      .run(b.username, hash, b.role);
    audit(db, req.user!.id, "user.create", String(r.lastInsertRowid));
    return { id: Number(r.lastInsertRowid) };
  });
  app.put("/api/users/:id", async (req) => {
    admin(req);
    const n = id(req);
    const b = z
      .object({
        role: roleSchema,
        disabled: z.boolean(),
        password: password.optional(),
      })
      .parse(req.body);
    const hash = b.password
      ? await argon2.hash(b.password, { type: argon2.argon2id })
      : null;
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(n) as any;
    if (!u) throw fail(404, "用户不存在");
    if (
      u.role === "admin" &&
      !u.disabled &&
      (b.role !== "admin" || b.disabled) &&
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0",
          )
          .get() as any
      ).n <= 1
    )
      throw fail(409, "必须保留至少一个启用的管理员");
    db.prepare(
      "UPDATE users SET role=?,disabled=?,password=COALESCE(?,password) WHERE id=?",
    ).run(b.role, +b.disabled, hash, n);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(n);
    audit(db, req.user!.id, "user.update", String(n));
    return { ok: true };
  });
  app.get("/api/audit", (req) => {
    admin(req);
    return db
      .prepare(
        "SELECT a.*,u.username FROM audit a LEFT JOIN users u ON a.user_id=u.id ORDER BY a.id DESC LIMIT 300",
      )
      .all();
  });
  app.get("/api/alerts", (req) => {
    admin(req);
    return {
      enabled:
        (
          db
            .prepare("SELECT value FROM settings WHERE key='notifications'")
            .get() as any
        )?.value === "true",
      configured: !!process.env.ALERT_WEBHOOK_URL,
      deliveries: db
        .prepare("SELECT * FROM notifications ORDER BY id DESC LIMIT 100")
        .all(),
    };
  });
  app.put("/api/alerts", (req) => {
    admin(req);
    const b = z.object({ enabled: z.boolean() }).parse(req.body);
    if (b.enabled && !process.env.ALERT_WEBHOOK_URL)
      throw fail(409, "请先在服务器设置 ALERT_WEBHOOK_URL");
    db.prepare(
      "INSERT INTO settings VALUES('notifications',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(String(b.enabled));
    audit(db, req.user!.id, "alerts.update", "webhook", String(b.enabled));
    return { ok: true };
  });
  const web = resolve("apps/web/dist");
  if (existsSync(web)) await app.register(staticFiles, { root: web });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/"))
      return reply.code(404).send({ message: "接口不存在" });
    if (existsSync(web) && req.method === "GET")
      return reply.sendFile("index.html");
    return reply
      .code(404)
      .send({ message: "请使用前端开发服务，或先运行 pnpm build" });
  });
  return app;
}
