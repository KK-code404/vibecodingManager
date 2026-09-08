import { useState } from "react";
import type { Host, Role, User } from "../../../packages/shared/src/index";
import { api, useData, time } from "./api";
import { useDeck } from "./state";
import {
  Box,
  Button,
  Empty,
  Field,
  Modal,
  Notice,
  Row,
  Select,
  Switch,
  useToast,
} from "./ui";
import { labels } from "./model";
function UserEditor({
  user,
  close,
  done,
}: {
  user?: User;
  close: () => void;
  done: () => void;
}) {
  const [name, setName] = useState(user?.username || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user?.role || "viewer");
  const [disabled, setDisabled] = useState(!!user?.disabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={user ? "编辑账号" : "创建账号"} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api(
              user ? `/users/${user.id}` : "/users",
              user ? "PUT" : "POST",
              user
                ? { role, disabled, ...(password ? { password } : {}) }
                : { username: name, password, role },
            );
            done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="fgrid">
          <Field label="账号">
            <input
              required
              disabled={!!user}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="角色">
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {["admin", "operator", "viewer"].map((r) => (
                <option value={r} key={r}>
                  {labels[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={user ? "新密码 / 留空不修改" : "初始密码 / 至少 12 位"}
            wide
          >
            <input
              type="password"
              required={!user}
              minLength={12}
              maxLength={128}
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {user && (
            <div className="swline">
              禁用账号
              <Switch
                label="禁用账号"
                checked={disabled}
                onChange={setDisabled}
              />
            </div>
          )}
        </div>
        {user && <Notice>保存账号变更会使该账号现有会话失效。</Notice>}
        {error && <Notice error>{error}</Notice>}
        <div className="modal-actions">
          <Button onClick={close}>取消</Button>
          <Button type="submit" kind="teal" busy={busy}>
            保存账号
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function Users() {
  const { data = [], error, refresh } = useData<User[]>("/users");
  const [edit, setEdit] = useState<User | null | undefined>(undefined);
  const toast = useToast();
  return (
    <Box
      title="账号与权限 / ACCESS CONTROL"
      extra={
        <Button icon="plus" kind="teal" onClick={() => setEdit(null)}>
          创建账号
        </Button>
      }
    >
      {error && <Notice error>{error}</Notice>}
      <table>
        <thead>
          <tr>
            <th>账号</th>
            <th>角色</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {data.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{labels[u.role]}</td>
              <td className={u.disabled ? "bad-text" : "ok-text"}>
                {u.disabled ? "已禁用" : "启用"}
              </td>
              <td>
                <Button mini onClick={() => setEdit(u)}>
                  编辑
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit !== undefined && (
        <UserEditor
          user={edit || undefined}
          close={() => setEdit(undefined)}
          done={() => {
            setEdit(undefined);
            void refresh();
            toast("账号已保存");
          }}
        />
      )}
      <div className="form-hint">
        管理员管理资产和账号；操作员可启停及查看日志；只读用户可查看健康和资源。
      </div>
    </Box>
  );
}
function HostEditor({
  host,
  close,
  done,
}: {
  host?: Host;
  close: () => void;
  done: () => void;
}) {
  const [h, setH] = useState(
    host
      ? { ...host }
      : {
          name: "",
          address: "",
          port: 22,
          username: "control-center",
          fingerprint: "",
          keyRef: "",
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={host ? "编辑节点连接" : "登记节点"} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api(
              host ? `/hosts/${host.id}` : "/hosts",
              host ? "PUT" : "POST",
              h,
            );
            done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="fgrid">
          {(
            [
              ["name", "节点名称"],
              ["address", "主机地址"],
              ["port", "SSH 端口"],
              ["username", "受限账号"],
              ["keyRef", "密钥引用 / 文件名"],
              ["fingerprint", "SHA256 主机指纹"],
            ] as const
          ).map(([key, label]) => (
            <Field label={label} key={key}>
              <input
                required={key !== "fingerprint"}
                type={key === "port" ? "number" : "text"}
                min={key === "port" ? 1 : undefined}
                max={key === "port" ? 65535 : undefined}
                value={h[key]}
                onChange={(e) =>
                  setH({
                    ...h,
                    [key]:
                      key === "port" ? Number(e.target.value) : e.target.value,
                  })
                }
              />
            </Field>
          ))}
        </div>
        <Notice>
          密钥只读挂载在服务器。通过可信渠道核对指纹后填写，留空时禁止 SSH
          连接。
        </Notice>
        {error && <Notice error>{error}</Notice>}
        <div className="modal-actions">
          <Button onClick={close}>取消</Button>
          <Button type="submit" kind="teal" busy={busy}>
            保存节点
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function Hosts() {
  const { hosts, refresh } = useDeck();
  const [edit, setEdit] = useState<Host | null | undefined>(undefined);
  const [busy, setBusy] = useState<number | null>(null);
  const toast = useToast();
  return (
    <Box
      title="节点连接 / SSH HOSTS"
      extra={
        <Button icon="plus" kind="teal" onClick={() => setEdit(null)}>
          登记节点
        </Button>
      }
    >
      <table>
        <thead>
          <tr>
            <th>节点</th>
            <th>连接地址</th>
            <th>账号</th>
            <th>信任状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {hosts.map((h) => (
            <tr key={h.id}>
              <td>{h.name}</td>
              <td>
                {h.address}:{h.port}
              </td>
              <td>{h.username}</td>
              <td>{h.fingerprint ? "已登记指纹" : "待配置指纹"}</td>
              <td>
                <div className="p-actions">
                  <Button mini onClick={() => setEdit(h)}>
                    编辑
                  </Button>
                  <Button
                    mini
                    busy={busy === h.id}
                    disabled={busy !== null || !h.fingerprint}
                    onClick={async () => {
                      setBusy(h.id);
                      try {
                        await api(`/hosts/${h.id}/verify`, "POST");
                        await refresh();
                        toast("SSH 连接验证通过");
                      } catch (e) {
                        toast((e as Error).message, "bad");
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    验证连接
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!hosts.length && <Empty>暂无节点</Empty>}
      {edit !== undefined && (
        <HostEditor
          host={edit || undefined}
          close={() => setEdit(undefined)}
          done={() => {
            setEdit(undefined);
            void refresh();
            toast("节点配置已保存");
          }}
        />
      )}
    </Box>
  );
}
function Audit() {
  const { data = [], error } = useData<any[]>("/audit");
  return (
    <Box
      title="审计记录 / AUDIT TRAIL"
      extra={<span>保留 90 天 · 最近 300 条</span>}
    >
      {error && <Notice error>{error}</Notice>}
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>发起人</th>
            <th>操作</th>
            <th>目标</th>
            <th>结果 / 详情</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id}>
              <td>{time(r.at)}</td>
              <td>{r.username || "系统"}</td>
              <td>{r.action}</td>
              <td>{r.target}</td>
              <td className="wrap-cell">{r.detail || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.length && <Empty>暂无审计记录</Empty>}
    </Box>
  );
}
function Alerts() {
  const { data, error, refresh } = useData<any>("/alerts");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Box title="通知配置 / WEBHOOK">
      {error && <Notice error>{error}</Notice>}
      <Row label="HTTPS Webhook">
        {data?.configured ? "服务器已配置" : "尚未配置"}
      </Row>
      <Row label="失败 / 恢复通知">
        <Switch
          label="启用告警通知"
          checked={!!data?.enabled}
          disabled={!data || busy || !data.configured}
          onChange={async (enabled) => {
            setBusy(true);
            try {
              await api("/alerts", "PUT", { enabled });
              await refresh();
              toast("通知设置已保存");
            } catch (e) {
              toast((e as Error).message, "bad");
            } finally {
              setBusy(false);
            }
          }}
        />
      </Row>
      <Notice>
        通知地址通过服务器 ALERT_WEBHOOK_URL
        环境变量配置，界面不展示密钥。维护与预期停机期间抑制通知。
      </Notice>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>投递状态</th>
            <th>尝试次数</th>
            <th>下次执行</th>
          </tr>
        </thead>
        <tbody>
          {data?.deliveries?.map((r: any) => (
            <tr key={r.id}>
              <td>#{r.id}</td>
              <td>{r.status}</td>
              <td>{r.attempts}</td>
              <td>{time(r.next_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data?.deliveries?.length && <Empty>暂无通知投递记录</Empty>}
    </Box>
  );
}
export default function Settings() {
  const { user } = useDeck();
  const [tab, setTab] = useState("users");
  return (
    <>
      <header className="phead">
        <div>
          <h2>系统设置</h2>
          <div className="sub">CONFIGURATION · IDENTITY / HOSTS / AUDIT</div>
        </div>
      </header>
      {user.role !== "admin" ? (
        <Box title="当前账号">
          <Row label="账号">{user.username}</Row>
          <Row label="角色">{labels[user.role]}</Row>
          <Notice>账号、节点、审计和通知配置由管理员管理。</Notice>
        </Box>
      ) : (
        <>
          <div className="settings-tabs">
            {[
              ["users", "账号与权限"],
              ["hosts", "节点连接"],
              ["audit", "审计记录"],
              ["alerts", "告警通知"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={"tab " + (tab === key ? "on" : "")}
                onClick={() => setTab(key)}
                aria-pressed={tab === key}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "users" ? (
            <Users />
          ) : tab === "hosts" ? (
            <Hosts />
          ) : tab === "audit" ? (
            <Audit />
          ) : (
            <Alerts />
          )}
        </>
      )}
    </>
  );
}
