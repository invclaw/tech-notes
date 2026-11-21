> [!NOTE] 分析基准
> 本文基于 [anomalyco/opencode](https://github.com/anomalyco/opencode)（MIT 协议）v2 架构源码梳理，与 [OpenClaw](#/openclaw/overview) 和 [Codex](#/codex/overview) 放在同一坐标系下进行架构级剖析。

## 1. OpenCode 是什么？核心架构特色

**OpenCode** 是一款开源、**完全模型无关**的 AI Coding Agent，采用 **TypeScript / Bun Monorepo + Effect-TS 函数式并发内核 + Drizzle SQLite** 构建。

它最鲜明的三个架构标签是：
1. **彻底的 Client / Server 分离**：核心引擎跑在独立 HTTP/SSE Server 上，终端 TUI、桌面 App、Web 界面、ACP 桥接与 SDK 全是无状态客户端，天然支持“本地界面连远端开发机”；
2. **Effect-TS 驱动的结构化并发与事务恢复**：所有后台任务、Session 串行执行、超时与崩溃恢复都建立在 Effect Fiber 与 SQLite 预写事务之上，边界非常干净；
3. **规则审批 + 隐藏 Git 快照时光机**：默认不强依赖 OS 沙箱或 Docker，而是用**声明式通配符权限规则**把关高危操作，同时在后台用**独立隐藏 Git 仓库**为每一步改动拍内容寻址快照，出错一键回滚。

![OpenCode 整体分层架构](./assets/opencode-arch.svg)

---

## 2. 三大主流开源 Agent 全景横评（OpenClaw vs Codex vs OpenCode）

把目前我们精读的三款代表性 Agent 放在同一张架构表里，彼此的取舍一目了然：

| 对比维度 | [OpenClaw](#/openclaw/overview) | [Codex](#/codex/overview) | **OpenCode** |
|---|---|---|---|
| **核心定位** | 7×24 多渠道个人/团队 **AI 控制面（Gateway）** | 工业级可嵌入 **Coding Agent 引擎** | 开源、模型无关的 **Client/Server Coding Agent** |
| **技术栈** | TypeScript / Node.js + SQLite/Postgres | Rust（~140 crates）+ TS/Python SDK | TypeScript / Bun + **Effect-TS** + Drizzle SQLite |
| **前端与接入形态** | 20+ IM 渠道 + Control UI + 原生设备节点 | TUI + Headless `exec` + `app-server`（JSON-RPC） | TUI + Desktop + Web + HTTP/SSE Server + ACP |
| **模型协议绑定** | 兼容 20+ 异构模型（三套协议全接） | 主力深度绑定 [OpenAI Responses](#/llm-protocols/openai-responses) | 通过 `@opencode/ai` 保持**完全模型无关** |
| **Agent Loop 与插话** | 三层嵌套循环 + 串行截断 Steer + 退出前复查 | Thread/Turn/Item 模型 + 原生 `turn/steer` | **单 Fiber 门铃协调器** + `Write-Ahead Claim` 崩溃恢复 |
| **上下文压缩策略** | [Session Pruning + 四段配额 + Safeguard](#/openclaw/agent-loop/compaction) | [远端压缩 V2 + 后台投机预压 + WorldState 重算](#/codex/core/compaction) | **后台预计算 + 四级渐进降采样 + 阶梯缩容** |
| **安全与隔离路线** | **Docker 容器默认** + 五大可插拔沙箱 + 5 层策略 | **三端 OS 原生进程沙箱** + `ExecPolicy` + Guardian | **通配符权限引擎**（跨机隔离/无人值守）+ **隐藏 Git 快照回滚** |
| **长期记忆设计** | [六类分层记忆 + Dreaming 后台防投毒晋升](#/openclaw/memory) | 线程记忆摘要 + 目录级 `AGENTS.md` | 轻量 `AGENTS.md` 指令发现 + 全文检索历史库 |
