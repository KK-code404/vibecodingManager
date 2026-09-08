import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, seed } from "../src/db.ts";
import { telemetry, events } from "../src/telemetry.ts";
test("telemetry preserves missing data and aggregates only internal samples within 24h", () => {
  const db = openDb(":memory:");
  seed(db);
  try {
    const now = Date.UTC(2026, 8, 6, 12);
    const empty = telemetry(db, now);
    assert.equal(empty.projects[1].availability, null);
    assert.equal(empty.projects[1].p95, null);
    assert.equal(empty.projects[1].maxOutage, null);
    assert.equal(empty.series.length, 96);
    assert.ok(empty.series.every((p) => p.total === 0 && p.latency === null));
    const write = db.prepare(
      "INSERT INTO checks(project_id,kind,ok,status_code,latency,error,at) VALUES(?,?,?,200,?,'',?)",
    );
    for (const [ok, latency, at] of [
      [1, 100, now - 90000],
      [0, 5000, now - 60000],
      [0, 5000, now - 30000],
      [1, 300, now],
    ])
      write.run(1, "internal", ok, latency, at);
    write.run(1, "public", 0, 5000, now);
    write.run(1, "internal", 0, 5000, now - 86400001);
    write.run(1, "internal", 0, 5000, now + 1);
    const t = telemetry(db, now);
    assert.equal(t.checks, 4);
    assert.equal(t.projects[1].availability, 50);
    assert.equal(t.projects[1].average, 200);
    assert.equal(t.projects[1].p95, 300);
    assert.equal(t.projects[1].p99, 300);
    assert.equal(t.projects[1].maxOutage, 60000);
    assert.equal(t.projects[2].availability, null);
    assert.equal(t.series[95].total, 4);
    assert.equal(t.series[95].latency, 200);
  } finally {
    db.close();
  }
});
test("telemetry does not count unobserved collection gaps as downtime and uses China midnight for daily alerts", () => {
  const db = openDb(":memory:");
  seed(db);
  try {
    const now = Date.UTC(2026, 8, 6, 1);
    const write = db.prepare(
      "INSERT INTO checks(project_id,kind,ok,latency,error,at) VALUES(1,'internal',0,5000,'',?)",
    );
    write.run(now - 3600000);
    write.run(now - 30000);
    write.run(now);
    const notify = db.prepare(
      "INSERT INTO notifications(event,next_at) VALUES(?,0)",
    );
    notify.run(
      JSON.stringify({ type: "failure", at: Date.UTC(2026, 8, 5, 17) }),
    );
    notify.run(
      JSON.stringify({ type: "failure", at: Date.UTC(2026, 8, 5, 15) }),
    );
    notify.run(JSON.stringify({ type: "recovery", at: now }));
    assert.equal(telemetry(db, now).projects[1].maxOutage, 30000);
    assert.equal(telemetry(db, now).alertsToday, 1);
  } finally {
    db.close();
  }
});
test("viewer event stream omits control tasks and raw sensitive error output", () => {
  const db = openDb(":memory:");
  seed(db);
  try {
    db.prepare(
      "INSERT INTO checks(project_id,kind,ok,latency,error,at) VALUES(1,'internal',0,5000,'password=secret',1)",
    ).run();
    db.prepare(
      "INSERT INTO tasks(id,project_id,user_id,action,status,created) VALUES('t',1,1,'restart','failed',2)",
    ).run();
    assert.equal(events(db, false).length, 1);
    assert.ok(!JSON.stringify(events(db, false)).includes("secret"));
    assert.equal(events(db, true)[0].id, "task-t");
  } finally {
    db.close();
  }
});
