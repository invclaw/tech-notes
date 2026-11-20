> [!NOTE] 分析基准
> 本文基于 [openai/codex](https://github.com/openai/codex)（Apache-2.0 协议）仓库结构与文档整理，聚焦架构设计原理与模块边界，帮助建立对现代工业级 Coding Agent 的系统认知。

## 1. Codex 是什么？它是一个完整的 Agent 吗？

**是的，而且它不只是个命令行工具，而是一整套用 Rust 构建、可被多端嵌入的 Coding Agent 运行时底座**（核心 `codex-rs/` 包含约 140 个 Rust crate，外加 TypeScript / Python SDK）。

它覆盖了一个完整 Agent 所需的全部闭环：
- **多形态前端**：自带终端 TUI、无头自动化 CLI（`exec`），同时通过标准 JSON-RPC 服务（`app-server`）驱动 VS Code / Cursor 插件、桌面 App 及第三方宿主；
- **完整执行引擎**：流式推理循环、补丁级代码编辑、上下文压缩、线程持久化/分叉/回滚、运行中插话（`turn/steer`）、MCP / Skills / Hooks / 插件扩展；
- **三端原生安全执行面**：macOS Seatbelt、Linux `bwrap` + Landlock/Seccomp、Windows AppContainer + Job Object 三端原生进程沙箱，叠加网络代理、`execpolicy` 规则引擎与 Guardian 自动审批；
- **工程化协作能力**：线程记忆摘要、Git Worktree 隔离、以及多 Agent 角色与消息板基础设施。

![OpenAI Codex 四层解耦架构全景](./assets/codex-arch.svg)

## 2. 为什么 Codex 选择四层解耦架构？

传统终端 Coding Agent 往往把 UI、大模型调用和本地子进程执行揉在一个进程里；Codex 刻意拆出了**四层清晰边界**：

1. **接入与形态层**：TUI、无头 CLI、IDE 插件、桌面端、SDK 全部降格为“客户端”，不包含核心推理逻辑；
2. **App-Server 协议层**：对外暴露统一的 **Thread / Turn / Item** JSON-RPC 协议，让同一套引擎同时服务终端、桌面和第三方控制面；
3. **Core 引擎层**：专注模型推理、工具编排、上下文压缩与会话状态演进，不关心命令到底跑在本机还是远端；
4. **Exec-Server 与安全执行层**：把进程执行、沙箱化文件访问、Shell 环境快照、三端沙箱与命令审批独立下沉为执行服务，天然支持本地与远端无缝切换。

## 3. 一图看懂：Codex vs OpenClaw 的定位差异

很多开发者会把 Codex 和 OpenClaw 拿来对比，其实两者处在**互补而非完全替代**的位置：

| 对比维度 | OpenAI Codex | OpenClaw |
|---|---|---|
| **核心定位** | **专业软件工程 Coding Agent 引擎** | **多渠道 7×24 个人/团队 AI 控制面（Gateway）** |
| **实现语言** | Rust 核心（约 140 crates）+ TS/Python SDK | TypeScript Monorepo（Node.js 控制面 + 约 200 插件） |
| **核心入口** | 终端 TUI、IDE 插件、桌面 App、`app-server` | WhatsApp / Telegram / Slack / Discord 等 20+ IM 渠道 + 设备节点 |
| **默认沙箱路线** | **OS 原生进程级沙箱**（毫秒级、零镜像、复用本机工具链） | **本地容器级默认（Docker / Podman）** + 可插拔远端/云机器 |
| **两者关系** | 可作为独立 Coding Agent 使用，也可作为被调用的执行引擎 | 控制面可直接把 **Codex App-Server** 作为底层执行 Harness 接入 |
