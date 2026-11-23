> [!NOTE] 分析基准
> 本文基于 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，MIT 协议）官方中文架构文档与包结构梳理，作为「主流 Agent 解析」的第五个代表性架构样本。

## 1. DeepSeek Harness（`dsh`）的核心哲学：一切皆插件

如果说 Pi 是“极简留白”、Codex 是“Rust 四层解耦”、OpenClaw 是“多渠道 Gateway 控制面”，那么 **DeepSeek Harness（`dsh`）** 则代表了第五条非常纯粹的架构路线：**「无特权内核 · 一切皆插件（Everything is a Plugin）」**。

它构建在 **Cordis** 插件框架之上（理论背景见论文 *A Programming Paradigm for Spatiotemporal Composability*）：
- **连 Agent Loop 自己都是插件**：模型适配器（`ctx.llm`）、工具注册表（`ctx.tools`）、会话日志（`ctx.sessions`）、提示词组装（`ctx.systemPrompt`）、乃至默认的 `AgentLoop` 驱动器本身，全都是平等的 Cordis 插件——**不存在不能替换的硬编码特权内核**；
- **可逆副作用与声明式组装**：插件注册的所有服务、事件监听器与工具都是可逆副作用，卸载时自动撤销；运行中的 `dsh` 就是一棵由 **Profile + Bundle（组合包）+ `cordis.patch.yml`** 按序叠加出的插件树（一套底座叠加不同组合包即可切换 `web` / `desktop` / `headless` / `sdk` / `acp`）；
- **Capability Seam（能力接缝）三角色拆分**：每项核心能力严格拆为 **Service Definition（接口）+ Service Provider（实现）+ Consumer（面向模型的工具）**。只要替换 `ctx.fs` 和 `ctx.subprocess` 两个提供方，Bash、PTY、LSP 就会一起无缝迁往远程沙箱，无需逐个工具重写。

![DeepSeek Harness 一切皆插件与 Cordis 架构全景](./assets/dsh-arch.svg)

---

## 2. 五大主流开源 Agent 全景横评

| 对比维度 | [OpenClaw](#/openclaw/overview) | [Codex](#/codex/overview) | [OpenCode](#/opencode/overview) | [Pi](#/pi/overview) | **DeepSeek Harness (`dsh`)** |
|---|---|---|---|---|---|
| **核心定位** | 7×24 多渠道 AI 控制面 | 工业级可嵌入 Coding 引擎 | Client/Server Coding Agent | 极简高可塑底座库 | **一切皆插件的时空可组合 Harness** |
| **底层框架/语言** | TS / Node.js | Rust（~140 crates） | TS / Bun + **Effect-TS** | TS / Node.js（零脚本加固） | TS / Node.js + **Cordis 插件树** |
| **会话存储模型** | SQLite + 压缩归档 | Thread / Turn / Item | SQLite + 隐藏 Git 快照 | 单文件树形 JSONL | **仅追加多代不可变 `SessionEvent` 日志** |
| **上下文压缩** | [Pruning + 四段配额 + Safeguard](#/openclaw/agent-loop/compaction) | [远端 V2 + 后台投机预压](#/codex/core/compaction) | [后台预压 + 四级降采样](#/opencode/loop-and-compaction) | [追加式 + 单轮切分](#/pi/loop-and-compaction) | **插件化四件套（工具修剪 + 摘要 + 图片卸载 + `/compact`）** |
| **本地沙箱路线** | Docker 容器默认 + 5 后端 | 三端 OS 进程沙箱（Win 用 AppContainer） | 通配符权限 + Git 快照（无内置沙箱） | 不内置，外置 Docker/MicroVM | **三端 OS 进程沙箱（Linux bwrap→Landlock / macOS Seatbelt / Win 原始 ACL 受限令牌）** |
| **代码执行模式** | `code_execution` | `code_mode` | `codemode` 后台任务 | `codemode` | **独立 `ptc-runtime`（异步/REPL/VM）** |
| **GUI 自动化** | 原生全栈 Browser + Computer | 走外部 MCP + Guardian | 内置 `plugin-browser` | 零内置，交扩展/MCP | **独占注册 Seam：`ctx.browserUse` + `ctx.computerUse`** |
