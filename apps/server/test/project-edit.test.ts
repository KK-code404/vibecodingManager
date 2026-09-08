import { test } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import { openDb, seed } from "../src/db.ts";
import { buildApp } from "../src/app.ts";
import { projects } from "../src/store.ts";
import { recordCheck } from "../src/monitor.ts";
test("editing project presentation preserves history, changing probe targets resets stale health", async () => {
  const db = openDb(":memory:");
  seed(db);
  const password = "test-password-123";
  db.prepare(
    "INSERT INTO users(username,password,role) VALUES('admin',?,'admin')",
  ).run(await argon2.hash(password));
  const origin = "http://localhost:5176";
  const app = await buildApp(db, { secure: false, origin });
  try {
    const p = { ...projects(db)[0], publicUrl: "", publicHealthUrl: "" };
    db.prepare("UPDATE projects SET config=? WHERE id=1").run(
      JSON.stringify(p),
    );
    recordCheck(db, 1, "internal", true, 25, 200, "", false);
    const r = await app.inject({
      url: "/api/auth/login",
      method: "POST",
      headers: { origin },
      payload: { username: "admin", password },
    });
    const headers = {
      origin,
      cookie: String(r.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": r.json().csrf,
    };
    const edit = {
      ...p,
      description: "Updated presentation",
      branch: "main",
      exposure: "tunnel",
    };
    assert.equal(
      (
        await app.inject({
          url: "/api/projects/1",
          method: "PUT",
          headers,
          payload: edit,
        })
      ).statusCode,
      200,
    );
    assert.equal(projects(db)[0].description, "Updated presentation");
    assert.equal(projects(db)[0].checks.length, 1);
    assert.equal(
      (
        await app.inject({
          url: "/api/projects/1",
          method: "PUT",
          headers,
          payload: {
            ...edit,
            internalUrl: "http://192.168.101.130:5175/health-new",
          },
        })
      ).statusCode,
      200,
    );
    assert.equal(projects(db)[0].checks.length, 0);
  } finally {
    await app.close();
    db.close();
  }
});
