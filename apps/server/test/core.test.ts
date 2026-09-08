import { test } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import { openDb, seed } from "../src/db.ts";
import { buildApp } from "../src/app.ts";
import {
  recordCheck,
  validateProject,
  createNotifier,
} from "../src/monitor.ts";
import { safeAddress, parseHttp, redact } from "../src/security.ts";
import { projects, hosts } from "../src/store.ts";
import { createRemoteService } from "../src/remote.ts";
import { backup } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("authentication, RBAC, CSRF, session revocation and last admin protection", async () => {
  const db = openDb(":memory:");
  seed(db);
  const hash = await argon2.hash("test-password-123");
  for (const role of ["admin", "operator", "viewer"])
    db.prepare("INSERT INTO users(username,password,role) VALUES(?,?,?)").run(
      role,
      hash,
      role,
    );
  const app = await buildApp(db, {
    secure: false,
    origin: "http://localhost:5176",
  });
  const base = { origin: "http://localhost:5176" };
  try {
    for (const url of [
      "/api/projects",
      "/api/hosts",
      "/api/users",
      "/api/audit",
      "/api/tasks",
      "/api/alerts",
      "/api/telemetry",
      "/api/events",
    ])
      assert.equal((await app.inject({ url })).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          url: "/api/projects",
          method: "POST",
          headers: base,
          payload: {},
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/auth/login",
          method: "POST",
          headers: base,
          payload: { username: "admin", password: "bad" },
        })
      ).statusCode,
      401,
    );
    const login = async (username: string) => {
      const r = await app.inject({
        url: "/api/auth/login",
        method: "POST",
        headers: base,
        payload: { username, password: "test-password-123" },
      });
      assert.equal(r.statusCode, 200);
      assert.match(r.headers["set-cookie"] as string, /HttpOnly/);
      return {
        ...base,
        cookie: (r.headers["set-cookie"] as string).split(";")[0],
        "x-csrf-token": r.json().csrf,
      };
    };
    const admin = await login("admin"),
      operator = await login("operator"),
      viewer = await login("viewer");
    for (const h of [viewer, operator])
      for (const url of ["/api/projects/test", "/api/hosts/collect"])
        assert.equal(
          (await app.inject({ url, method: "POST", headers: h, payload: {} }))
            .statusCode,
          403,
        );
    for (const url of ["/api/telemetry", "/api/events"])
      assert.equal(
        (await app.inject({ url, headers: viewer })).statusCode,
        200,
      );
    assert.equal(
      (
        await app.inject({
          url: "/api/projects/test",
          method: "POST",
          headers: admin,
          payload: {
            ...projects(db)[0],
            publicUrl: "",
            publicHealthUrl: "",
            internalUrl: "http://169.254.169.254/",
          },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ url: "/api/projects", headers: viewer })).json()
        .length,
      2,
    );
    for (const h of [viewer, operator])
      for (const url of ["/api/users", "/api/audit", "/api/alerts"])
        assert.equal((await app.inject({ url, headers: h })).statusCode, 403);
    for (const [url, payload] of [
      ["/api/projects/1/actions", { action: "stop" }],
      ["/api/projects/1/maintenance", { enabled: true }],
      ["/api/hosts/1/verify", {}],
    ] as const)
      assert.equal(
        (await app.inject({ url, method: "POST", headers: viewer, payload }))
          .statusCode,
        403,
      );
    assert.equal(
      (
        await app.inject({
          url: "/api/projects/1/logs?service=api",
          headers: viewer,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/users",
          method: "POST",
          headers: { ...admin, "x-csrf-token": "bad" },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/users",
          method: "POST",
          headers: { ...admin, origin: "https://evil.example" },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/users/1",
          method: "PUT",
          headers: admin,
          payload: { role: "viewer", disabled: false },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/users/3",
          method: "PUT",
          headers: admin,
          payload: { role: "viewer", disabled: true },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: "/api/projects", headers: viewer })).statusCode,
      401,
    );
    await app.inject({
      url: "/api/auth/logout",
      method: "POST",
      headers: operator,
    });
    assert.equal(
      (await app.inject({ url: "/api/projects", headers: operator }))
        .statusCode,
      401,
    );
  } finally {
    await app.close();
    db.close();
  }
});
test("health immediately fails, incident requires three failures and two recovery samples; maintenance suppresses", () => {
  const db = openDb(":memory:");
  seed(db);
  const write = (ok: boolean, maintenance = false) =>
    recordCheck(db, 1, "internal", ok, 15, ok ? 200 : 503, "", maintenance);
  write(false);
  assert.equal(projects(db)[0].checks[0].ok, false);
  assert.equal(projects(db)[0].checks[0].active, 0);
  write(false);
  write(false);
  assert.equal(projects(db)[0].checks[0].active, 1);
  write(false);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM notifications").get()!.n,
    1,
  );
  write(true);
  assert.equal(projects(db)[0].checks[0].active, 1);
  write(true);
  assert.equal(projects(db)[0].checks[0].active, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM notifications").get()!.n,
    2,
  );
  write(false, true);
  write(false, true);
  write(false, true);
  assert.equal(projects(db)[0].checks[0].active, 0);
  db.close();
});
test("SSRF rejects metadata, loopback, mapped IPv6 and arbitrary internal targets", async () => {
  for (const ip of [
    "169.254.169.254",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "::ffff:169.254.169.254",
    "224.0.0.1",
    "100.100.100.200",
  ])
    assert.equal(safeAddress(ip, true), false, ip);
  assert.equal(safeAddress("192.168.101.130", true), true);
  assert.equal(safeAddress("192.168.101.130"), false);
  assert.throws(() => parseHttp("http://user:pass@example.com"));
  assert.throws(() => parseHttp("file:///etc/passwd"));
  const db = openDb(":memory:");
  seed(db);
  await assert.rejects(
    validateProject(db, {
      ...projects(db)[0],
      publicUrl: "",
      publicHealthUrl: "",
      internalUrl: "http://169.254.169.254/api",
    }),
  );
  db.close();
});
test("remote project lock, failure state, maintenance rollback and startup reconciliation", async () => {
  const db = openDb(":memory:");
  seed(db);
  const h = hosts(db)[0];
  db.prepare("UPDATE hosts SET config=? WHERE id=1").run(
    JSON.stringify({ ...h, fingerprint: "SHA256:" + "a".repeat(43) }),
  );
  let finish!: (value: any) => void;
  const service = createRemoteService(db, async (_h, req) => {
    if (req.operation === "status")
      return {
        projects: {
          oilorder: {
            runtime: "running",
            composeProject: "categoryb-order",
            controlledServices: ["frontend", "api", "worker", "beat"],
          },
        },
      };
    return await new Promise((res) => {
      finish = res;
    });
  });
  await service.collect();
  const task = service.queue(1, 1, "stop");
  assert.throws(() => service.queue(1, 1, "stop"), /已有/);
  finish({ ok: true });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(
    (db.prepare("SELECT status FROM tasks WHERE id=?").get(task) as any).status,
    "succeeded",
  );
  assert.equal(projects(db)[0].maintenance, true);
  db.prepare(
    "INSERT INTO tasks(id,project_id,user_id,action,status,created) VALUES('recovery',2,1,'restart','executing',1)",
  ).run();
  service.recover();
  assert.equal(
    (db.prepare("SELECT status FROM tasks WHERE id='recovery'").get() as any)
      .status,
    "uncertain",
  );
  db.close();
});
test("SQLite backup restores seeded projects and accounts without reseeding", async () => {
  const dir = mkdtempSync(join(tmpdir(), "control-backup-"));
  const db = openDb(join(dir, "live.sqlite"));
  seed(db);
  db.prepare(
    "INSERT INTO users(username,password,role) VALUES('admin','hash','admin')",
  ).run();
  await backup(db, join(dir, "backup.sqlite"));
  db.close();
  const restored = openDb(join(dir, "backup.sqlite"));
  seed(restored);
  assert.equal(projects(restored).length, 2);
  assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM users").get()!.n, 1);
  restored.close();
  rmSync(dir, { recursive: true });
});
test("disabled notifications are suppressed without making a network call", async () => {
  const db = openDb(":memory:");
  seed(db);
  db.prepare("INSERT INTO notifications(event,next_at) VALUES(?,0)").run(
    JSON.stringify({ projectId: 1, type: "failure" }),
  );
  await createNotifier(db)();
  assert.equal(
    db.prepare("SELECT status FROM notifications").get()!.status,
    "suppressed",
  );
  db.close();
});
test("common credentials are removed from logs", () => {
  const result = redact(
    "password=abc token: xyz\nAuthorization: Bearer secret\nhttps://user:pass@example.com",
  );
  assert.ok(!result.includes("abc"));
  assert.ok(!result.includes("xyz"));
  assert.ok(!result.includes("Bearer secret"));
  assert.ok(!result.includes("user:pass"));
});
