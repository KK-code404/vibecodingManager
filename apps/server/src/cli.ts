import { openDb, seed, audit } from "./db.ts";
import { backup } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import argon2 from "argon2";
if (existsSync(".env")) process.loadEnvFile(".env");
const db = openDb();
seed(db);
const command = process.argv[2];
try {
  if (command === "migrate") console.log("数据库迁移和初始资产加载完成");
  else if (command === "admin") {
    const username = process.env.ADMIN_USERNAME || process.argv[3];
    let password = process.env.ADMIN_PASSWORD;
    if (!username || !/^[a-zA-Z0-9_.-]{3,64}$/.test(username))
      throw new Error(
        "设置 ADMIN_USERNAME 或传入用户名（3–64 位英文、数字、._-）",
      );
    if (!password && process.stdin.isTTY) {
      process.stdout.write("管理员密码（至少12位，不回显）：");
      process.stdin.setRawMode(true);
      process.stdin.resume();
      password = await new Promise<string>((res, rej) => {
        let s = "";
        const handler = (b: Buffer) => {
          for (const c of b.toString()) {
            if (c === "\u0003") {
              process.stdin.off("data", handler);
              rej(new Error("已取消"));
              return;
            }
            if (c === "\r" || c === "\n") {
              process.stdin.off("data", handler);
              res(s);
              return;
            }
            if (c === "\u007f" || c === "\b") s = s.slice(0, -1);
            else s += c;
          }
        };
        process.stdin.on("data", handler);
      }).finally(() => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
      });
    }
    if (!password || password.length < 12 || password.length > 128)
      throw new Error(
        "密码长度必须为12–128位；非交互环境通过 ADMIN_PASSWORD 注入",
      );
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    db.prepare(
      "INSERT INTO users(username,password,role) VALUES(?,?,'admin') ON CONFLICT(username) DO UPDATE SET password=excluded.password,role='admin',disabled=0",
    ).run(username, hash);
    const u = db
      .prepare("SELECT id FROM users WHERE username=?")
      .get(username) as any;
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
    audit(db, null, "admin.cli.reset", String(u.id));
    console.log("管理员已创建/恢复，旧会话已失效");
  } else if (command === "backup") {
    const destination = process.argv[3];
    if (
      !destination ||
      existsSync(destination) ||
      resolve(destination) ===
        resolve(process.env.DATABASE_PATH || "./data/control.sqlite")
    )
      throw new Error("请提供不存在的备份文件路径");
    await backup(db, destination);
    console.log("一致性备份完成：" + destination);
  } else throw new Error("用法：admin / migrate / backup <路径>");
} finally {
  db.close();
}
