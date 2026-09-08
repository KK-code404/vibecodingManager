import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createHash } from "node:crypto";
export function tokenHash(s: string) {
  return createHash("sha256").update(s).digest("hex");
}
export function safeAddress(address: string, allowPrivate = false) {
  if (!ipaddr.isValid(address)) return false;
  const ip = ipaddr.process(address);
  const range = ip.range();
  return (
    range === "unicast" ||
    (allowPrivate && (range === "private" || range === "uniqueLocal"))
  );
}
export async function resolveSafe(host: string, allowPrivate = false) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const records = await Promise.race([
    lookup(host, { all: true }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("DNS 解析超时")), 5000);
    }),
  ]).finally(() => clearTimeout(timer));
  if (
    !records.length ||
    records.some((r) => !safeAddress(r.address, allowPrivate))
  )
    throw new Error("目标地址不在允许的网络范围内");
  return records[0];
}
export function parseHttp(value: string) {
  const u = new URL(value);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.hash
  )
    throw new Error("仅允许无凭据的 HTTP/HTTPS 地址");
  return u;
}
export async function safeHttp(
  value: string,
  allowPrivate = false,
  body?: string,
) {
  const u = parseHttp(value);
  const record = await resolveSafe(u.hostname, allowPrivate);
  return new Promise<number>((resolve, reject) => {
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(
      u,
      {
        method: body ? "POST" : "GET",
        lookup: ((_host: any, options: any, cb: any) =>
          options.all
            ? cb(null, [record])
            : cb(null, record.address, record.family)) as any,
        headers: body
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            }
          : {},
        timeout: 5000,
      },
      (res) => {
        resolve(res.statusCode || 0);
        res.destroy();
      },
    );
    const deadline = setTimeout(() => req.destroy(new Error("请求超时")), 5000);
    req.on("close", () => clearTimeout(deadline));
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
    req.end(body);
  });
}
export function redact(text: string) {
  return text
    .replace(/(authorization\s*[:=]\s*)([^\r\n]+)/gi, "$1[REDACTED]")
    .replace(
      /((?:password|passwd|token|secret|api[_-]?key)\s*["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}
