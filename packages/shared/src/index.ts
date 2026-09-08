import { z } from "zod";
export const roleSchema = z.enum(["admin", "operator", "viewer"]);
export type Role = z.infer<typeof roleSchema>;
export const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
export const hostSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).default(22),
  username: identifier.default("control-center"),
  fingerprint: z
    .string()
    .regex(/^SHA256:[A-Za-z0-9+/]{43}$/)
    .or(z.literal(""))
    .default(""),
  keyRef: identifier.default("vm130"),
});
export const projectSchema = z
  .object({
    name: z.string().min(1).max(100),
    stack: z.string().max(500),
    description: z.string().max(500).optional(),
    branch: z.string().max(100).optional(),
    exposure: z.enum(["tunnel", "dns", "unknown"]).optional(),
    repository: z
      .string()
      .url()
      .refine((v) => new URL(v).protocol === "https:"),
    deployment: z.enum(["pending", "undeployed", "deployed"]),
    hostId: z.number().int().positive().nullable(),
    remoteId: identifier,
    composeProject: identifier.or(z.literal("")),
    directory: z.string().max(500).default(""),
    publicUrl: z.string().url().or(z.literal("")),
    internalUrl: z.string().url().or(z.literal("")),
    publicHealthUrl: z.string().url().or(z.literal("")),
    tcpPort: z.number().int().min(1).max(65535).nullable(),
    services: z.array(identifier).max(30),
    controlledServices: z.array(identifier).max(30),
  })
  .refine((p) => p.controlledServices.every((s) => p.services.includes(s)), {
    message: "控制服务必须属于项目服务",
  });
export type ProjectInput = z.infer<typeof projectSchema>;
export type Project = ProjectInput & {
  id: number;
  maintenance: boolean;
  runtime: string;
  runtimeAt: number | null;
  checks: Check[];
};
export type Check = {
  id: number;
  kind: string;
  ok: boolean;
  statusCode: number | null;
  latency: number;
  error: string;
  at: number;
  active: boolean;
  failures: number;
  successes: number;
};
export type Host = z.infer<typeof hostSchema> & {
  id: number;
  sample?: { at: number; data: any; error: string };
};
export type User = {
  id: number;
  username: string;
  role: Role;
  disabled: number;
};
export const actionSchema = z.object({
  action: z.enum(["start", "stop", "restart"]),
});
export const labels: Record<string, string> = {
  pending: "待确认",
  undeployed: "未部署",
  deployed: "已部署",
  unknown: "未知",
  running: "运行中",
  partial: "部分运行",
  stopped: "已停止",
  admin: "管理员",
  operator: "操作员",
  viewer: "只读用户",
  internal: "内网 HTTP",
  public: "公网 HTTP",
  tcp: "TCP 端口",
  queued: "排队中",
  executing: "执行中",
  succeeded: "成功",
  failed: "失败",
  uncertain: "结果待核对",
  timeout: "超时",
};
