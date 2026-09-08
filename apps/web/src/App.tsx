import { lazy, Suspense, useEffect, useState } from "react";
import type { User } from "../../../packages/shared/src/index";
import { api, setCsrf } from "./api";
import { Button, Icon, Notice, useToast } from "./ui";
import { DeckProvider, go, useDeck, useRoute } from "./state";
import { labels, status, shortTime } from "./model";
import { ThemeToggle } from "./theme";
const Projects = lazy(() => import("./Projects"));
const ProjectDetail = lazy(() => import("./ProjectDetail"));
const ProjectForm = lazy(() => import("./ProjectForm"));
const Monitor = lazy(() => import("./Monitor"));
const Events = lazy(() => import("./Events"));
const Settings = lazy(() => import("./AdminPages"));
function Login({ onLogin }: { onLogin: (data: any) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const [clock] = useState(() => shortTime(Date.now()));
  const lines = [
    ["INITIALIZING CONTROL.DECK", "OK"],
    ["INTERFACE MODULE LOADED", "OK"],
    ["SECURE SESSION REQUIRED", "AUTH"],
    ["HOST TELEMETRY AWAITING LOGIN", "WAIT"],
    ["WAITING FOR OPERATOR", "_"],
  ];
  return (
    <div id="login-scene" className="dA scene">
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <div className="login-box">
        <div className="lg-l">
          <div className="word">
            <i />
            CONTROL·DECK
          </div>
          <div className="boot">
            {lines.map(([text, end], i) => (
              <div key={text} style={{ animationDelay: i * 0.28 + "s" }}>
                <span className="t">{clock}</span> {text}
                <br />
                <span className={end === "OK" ? "ok" : "t"}>[{end}]</span>
              </div>
            ))}
          </div>
          <p className="login-node">
            统一项目控制中心
            <br />
            PROJECT OPERATIONS TERMINAL
          </p>
        </div>
        <div className="lg-r">
          <h3>操作员登录</h3>
          <div className="tip">OPERATOR SIGN-IN · 统一项目控制中心</div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                onLogin(
                  await api("/auth/login", "POST", { username, password }),
                );
                toast("身份验证通过");
                go("home");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="fld">
              <span>账号 / ACCOUNT</span>
              <div className="ctl">
                <Icon name="user" />
                <input
                  aria-label="账号"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </label>
            <label className="fld">
              <span>密码 / PASSWORD</span>
              <div className="ctl">
                <Icon name="lock" />
                <input
                  aria-label="密码"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </label>
            <div className="lg-row">
              <span>安全会话 · 8 小时</span>
              <button
                type="button"
                className="text-action"
                onClick={() =>
                  toast(
                    "请联系管理员重置密码；部署管理员可使用 pnpm admin 恢复账号。",
                    "warn",
                  )
                }
              >
                忘记密码？
              </button>
            </div>
            {error && <Notice error>{error}</Notice>}
            <button className="lg-go" disabled={busy}>
              {busy ? "身份验证中…" : "登 录 / SIGN IN →"}
            </button>
          </form>
          <div className="lg-foot">
            使用独立账号登录 · 操作按角色授权
            <br />
            所有启停操作写入审计日志
          </div>
        </div>
      </div>
    </div>
  );
}
function Shell({ logout }: { logout: () => Promise<void> }) {
  const { user, projects, loading, error } = useDeck();
  const route = useRoute();
  const alerts = projects.filter((p) => status(p).key === "alert").length;
  const allowed = [
    "home",
    "projects",
    "project",
    "monitor",
    "logs",
    "add",
    "settings",
  ];
  useEffect(() => {
    if (!allowed.includes(route.page)) go("home");
  }, [route.page]);
  const active =
    route.page === "project" || route.page === "add" ? "projects" : route.page;
  const nav = [
    ["home", "home", "总览"],
    ["projects", "cube", "项目"],
    ["monitor", "pulse", "监控"],
    ["logs", "log", "日志"],
  ];
  let content;
  switch (route.page) {
    case "project":
      content = <ProjectDetail id={Number(route.query.get("id"))} />;
      break;
    case "add":
      content = <ProjectForm id={Number(route.query.get("id")) || undefined} />;
      break;
    case "monitor":
      content = <Monitor />;
      break;
    case "logs":
      content = <Events />;
      break;
    case "settings":
      content = <Settings />;
      break;
    default:
      content = <Projects projectView={route.page === "projects"} />;
  }
  return (
    <div className="dA app scene">
      <div className="shell">
        <aside className="side">
          <div className="s-brand">
            <i />
            CONTROL·DECK <span title="界面版本">v2.1</span>
          </div>
          <div className="s-lab">工作台</div>
          <nav>
            {nav.map(([key, icon, title]) => (
              <a
                href={"#/" + key}
                key={key}
                className={"s-item " + (active === key ? "on" : "")}
                aria-current={active === key ? "page" : undefined}
              >
                <Icon name={icon} />
                {title}
                {key === "monitor" && alerts > 0 && (
                  <span className="badge">{alerts}</span>
                )}
              </a>
            ))}
          </nav>
          <div className="s-lab">系统</div>
          <a
            href="#/settings"
            className={"s-item " + (active === "settings" ? "on" : "")}
          >
            <Icon name="gear" />
            设置
          </a>
          <div className="sidebar-theme">
            <ThemeToggle />
          </div>
          <div className="s-user">
            <span className="av">{user.username[0].toUpperCase()}</span>
            <div className="account-name">
              {user.username}
              <br />
              <span>{labels[user.role]}</span>
            </div>
            <Button icon="logout" aria-label="退出登录" onClick={logout} />
          </div>
        </aside>
        <main className="main">
          <div
            key={route.page + "-" + route.query.get("id")}
            className="view-anim"
          >
            {error && <Notice error>{error} · 请检查连接后刷新</Notice>}
            {loading ? (
              <Notice>正在读取项目与节点数据…</Notice>
            ) : (
              <Suspense fallback={<Notice>正在加载工作区…</Notice>}>
                {content}
              </Suspense>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const toast = useToast();
  function logged(r: any) {
    setCsrf(r.csrf);
    setUser(r.user);
  }
  useEffect(() => {
    api("/auth/me")
      .then(logged)
      .catch(() => go("login"))
      .finally(() => setReady(true));
    const expired = () => {
      setCsrf("");
      setUser(null);
      go("login");
    };
    addEventListener("session-expired", expired);
    return () => removeEventListener("session-expired", expired);
  }, []);
  if (!ready)
    return <div className="loading-screen">INITIALIZING CONTROL·DECK…</div>;
  if (!user) return <Login onLogin={logged} />;
  return (
    <DeckProvider user={user}>
      <Shell
        logout={async () => {
          try {
            await api("/auth/logout", "POST");
            setCsrf("");
            setUser(null);
            go("login");
          } catch (e) {
            toast((e as Error).message, "bad");
          }
        }}
      />
    </DeckProvider>
  );
}
