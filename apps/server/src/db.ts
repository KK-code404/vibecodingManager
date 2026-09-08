import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export function openDb(
  path = process.env.DATABASE_PATH || "./data/control.sqlite",
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS hosts(id INTEGER PRIMARY KEY,config TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY,config TEXT NOT NULL,maintenance INTEGER NOT NULL DEFAULT 0,runtime TEXT NOT NULL DEFAULT 'unknown',runtime_at INTEGER);
 CREATE TABLE IF NOT EXISTS checks(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,kind TEXT NOT NULL,ok INTEGER NOT NULL,status_code INTEGER,latency INTEGER NOT NULL,error TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS checks_project_time ON checks(project_id,at);
 CREATE TABLE IF NOT EXISTS incidents(project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,kind TEXT NOT NULL,failures INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(project_id,kind));
 CREATE TABLE IF NOT EXISTS samples(id INTEGER PRIMARY KEY,host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,data TEXT NOT NULL,error TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS samples_host_time ON samples(host_id,at);
 CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id),user_id INTEGER NOT NULL,action TEXT NOT NULL,status TEXT NOT NULL,result TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,finished INTEGER);
 CREATE UNIQUE INDEX IF NOT EXISTS tasks_single_active ON tasks(project_id) WHERE status IN ('queued','executing');
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT NOT NULL,target TEXT NOT NULL,detail TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY,event TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending');
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 INSERT OR IGNORE INTO migrations(version) VALUES(1);`);
  return db;
}
export type DB = ReturnType<typeof openDb>;
export function audit(
  db: DB,
  user: number | null,
  action: string,
  target: string,
  detail = "",
) {
  db.prepare(
    "INSERT INTO audit(user_id,action,target,detail,at) VALUES(?,?,?,?,?)",
  ).run(user, action, target, detail, Date.now());
}
export function seed(db: DB) {
  if (db.prepare("SELECT value FROM settings WHERE key='seeded'").get()) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO hosts(id,config) VALUES(1,?)").run(
      JSON.stringify({
        name: "Ubuntu · VM130",
        address: "192.168.101.130",
        port: 22,
        username: "control-center",
        fingerprint: "",
        keyRef: "vm130",
      }),
    );
    const base = {
      deployment: "deployed",
      hostId: 1,
      directory: "",
      services: [],
      controlledServices: [],
    };
    const projects = [
      {
        ...base,
        name: "油品发货核销平台",
        stack:
          "Vue 3 · TypeScript · FastAPI · PostgreSQL 17 · Redis 7 · Celery · Nginx",
        repository: "https://github.com/KK-code404/CategoryB-Order",
        remoteId: "oilorder",
        composeProject: "categoryb-order",
        publicUrl: "https://oilorder.kkhub.com.cn",
        internalUrl: "http://192.168.101.130:5175/api/health",
        publicHealthUrl: "https://oilorder.kkhub.com.cn/api/health",
        tcpPort: 5175,
        services: ["frontend", "api", "db", "redis", "worker", "beat"],
        controlledServices: ["frontend", "api", "worker", "beat"],
      },
      {
        ...base,
        name: "ProjectManager",
        stack: "React 19 · Vite 7 · Node.js · Express 5 · JWT · bcrypt",
        repository: "https://github.com/KK-code404/projectManager",
        remoteId: "projectmanager",
        composeProject: "projectmanager",
        directory: "/home/kkadmin/apps/projectManager",
        publicUrl: "https://pm.kkhub.com.cn",
        internalUrl: "http://192.168.101.130:5174/api/health",
        publicHealthUrl: "https://pm.kkhub.com.cn/api/health",
        tcpPort: 5174,
        services: ["project-manager"],
        controlledServices: ["project-manager"],
      },
    ];
    for (const p of projects)
      db.prepare("INSERT INTO projects(config) VALUES(?)").run(
        JSON.stringify(p),
      );
    db.prepare("INSERT INTO settings VALUES('seeded','true')").run();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
