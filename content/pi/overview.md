> [!NOTE] 分析基准
> 本文基于 [earendil-works/pi](https://github.com/earendil-works/pi)（MIT 协议，Mario Zechner 主导）源码与官方文档梳理。[OpenClaw](#/openclaw/overview) 的官方 README 也明确致谢了 Pi 的设计启发。

## 1. Pi 是什么？极简主义的“可塑型 Agent 底座”

在所有主流开源 Agent 中，**Pi** 的哲学最鲜明、最克制：**“让工具适应你的工作流，而不是让你迁就工具。”**

它刻意不做“大而全”的内置功能——**不内置 Plan Mode、不内置 Sub-agents、不内置繁琐的权限弹窗系统**，而是把精力全部花在打磨一套**极度干净、模块解耦的可复用内核库**上：
- **`pi-ai`**：统一多模型调用层（OpenAI / Anthropic / Google / 本地模型，详见 [大模型推理协议解析](#/llm-protocols/overview)）；
- **`pi-agent-core`**：极简 Agent 工具循环与状态机；
- **`pi-coding-agent`**：交互式 CLI、Print/JSON 自动化、JSONL RPC 与进程内 TypeScript SDK；
- **`pi-tui`**：带差分渲染（Differential Rendering）的高性能终端 UI 库；
- **`pi-durable` & `chord`**：面向跨进程应用的持久化对话/文档与热重载插件运行时。

任何你想要的高级工作流（子 Agent、规划模式、自定义 UI、微虚机隔离），都通过 **TypeScript Extensions** 和 **Pi Packages** 按需组装。

![Pi 分层极简架构与树形会话全景](./assets/pi-arch.svg)

---

## 2. 四大主流开源 Agent 全景对比（OpenClaw vs Codex vs OpenCode vs Pi）

| 对比维度 | [OpenClaw](#/openclaw/overview) | [Codex](#/codex/overview) | [OpenCode](#/opencode/overview) | **Pi** |
|---|---|---|---|---|
| **核心定位** | 7×24 多渠道 **AI 控制面（Gateway）** | 工业级可嵌入 **Coding Agent 引擎** | 模型无关 **Client/Server Coding Agent** | **极简高可塑 Agent Harness + 底座库** |
| **技术栈** | TypeScript / Node.js | Rust（~140 crates） | TypeScript / Bun + Effect-TS | TypeScript / Node.js（零依赖脚本加固） |
| **会话数据模型** | SQLite 会话流 + 压缩归档 | Thread / Turn / Item（Rollout + 状态库） | SQLite 会话 + 隐藏 Git 快照 | **单文件树形 JSONL（原地分叉 + 分支摘要）** |
| **Agent Loop 与插话** | 三层嵌套循环 + 串行截断 Steer | 原生 `turn/steer` + `turn/completed` | 单 Fiber 门铃模型 + 预写崩溃恢复 | 极简 Turn 循环（Steer 轮间进入，Follow-up 末尾进入） |
| **上下文压缩** | [Pruning + 四段配额 + Safeguard](#/openclaw/agent-loop/compaction) | [远端 V2 + 后台投机预压 + WorldState](#/codex/core/compaction) | [后台预计算 + 四级降采样 + 阶梯缩容](#/opencode/loop-and-compaction) | **追加式 `CompactionEntry` + 单轮切分 + 分支摘要** |
| **安全与隔离哲学** | **Docker 容器默认** + 5 层工具策略 | **三端 OS 原生进程沙箱** + ExecPolicy | **通配符权限引擎** + 隐藏 Git 快照回滚 | **不内置权限系统**，外置 Docker / 凭据代换代理 / Gondolin MicroVM |
| **扩展重心** | ~200 官方渠道/模型/能力插件 | MCP + Skills + Hooks + App-Server | MCP + Skills + Core/GUI 双层插件 | **进程内全权 TS Extensions + Pi Packages** |
