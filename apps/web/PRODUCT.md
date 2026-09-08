# 项目控制中心

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

开发者及其管理员、操作员、只读协作者。日常查看项目健康、访问网站、查看日志并在授权范围内启停服务。

## Product Purpose

集中管理已有 GitHub 项目及 Linux Docker VM，统一监控和受限 SSH 控制。

## Capabilities and Constraints

根据此前用户已确认方案：React/TypeScript、Fastify、SQLite；真实 Session 登录，服务端 RBAC/CSRF；启动/停止/重启均经受限 SSH。两个已部署项目位于192.168.101.130，端口5175/5174。只控制白名单应用，不控制数据库。未知数据不能伪造为在线。公网域名和SSH指纹仍待生产接入。

## Brand Commitments

本次用户明确指定附件 MD 与 HTML 原型为重设计依据：CONTROL·DECK 深空遥测站，桌面最小宽1180px，原生组件和内联SVG。保留已确认产品事实与权限，附件mock数据和模拟成功脚本不是生产要求。

## Evidence on Hand

真实资产与接口在现有实现中；附件为布局、色值、交互参考。没有8个真实项目、3台在线VM、已启用Access或99.92%可用率的证据。
