> [!FOCUS] 能力接缝的威力
> 在 DeepSeek Harness 中，**沙箱、PTC 代码执行、Browser Use、Computer Use 与多 Agent 协作**全部遵循同一套「Service Definition + Provider + Consumer」接缝模型，彼此隔离又可自由替换。

---

## 1. 三端本地进程沙箱（为什么 Windows 不用 AppContainer？）

`packages/sandbox` 将子进程执行限制在三档策略之下：**`read-only`（只读）**、**`workspace-write`（仅工作区可写）**、**`danger-full-access`（无限制）**，被策略拦截的命令支持经用户批准做**一次性升权重试**。

各平台后端选型（可对照 [AI Agent 沙箱技术全景 → 第 2 章](#/agent-sandbox/process-and-runtime)）：
- **Linux**：优先使用 **`bwrap`（Bubblewrap）**，环境不支持时回退到 **Landlock LSM**；
- **macOS**：使用原生 **Seatbelt**；
- **Windows（极具代表性的工程取舍）**：专门维护了 `sandbox-windows-acl`，刻意选用**原始 ACL 受限令牌（Restricted Token）**而非 AppContainer——原因是面向本地开发工具链时，AppContainer 过于严苛的包隔离常导致普通编译器与 CLI 兼容性受挫，而原始 ACL 受限令牌能更稳妥地把写权限锁死在工作区与私有临时目录内。
- **清晰的架构划界**：DSH 明确规定 `ctx.sandbox` **只负责与宿主机共享内核与文件系统的本机子进程**；如果需要容器、MicroVM 或远程执行器，则直接替换上层的 `ctx.fs` + `ctx.subprocess` 整个能力接缝，绝不把远程执行硬塞进进程沙箱接口。

---

## 2. PTC 运行时（Programmatic Tool Calling · `run_code`）

面对需要连续查几十个文件、做复杂过滤聚合的任务，传统一轮调一次工具极其浪费延迟与 Token。DSH 独立抽出了 **`packages/ptc-runtime`**：
- 把宿主注册的异步工具能力绑定为程序可调用函数，向模型暴露 `run_code` 工具；
- `ptc-runtime-node` 支持以三种形态求值模型编写的 TypeScript/JS 代码：
  1. **异步函数体**：每次执行独立新进程，用完即毁；
  2. **REPL 语句**：为每个显式状态所有者常驻一个进程，跨步保留变量状态；
  3. **VM Script**：按 `scriptPersistence` 可选保留内存状态；
- 全程遵守配置的文件策略，异常作为结构化结果返回给模型自愈诊断，进程结束即回收全部内存。

---

## 3. 独占注册的 Browser Use、Computer Use 与多 Agent 团队

- **Browser Use（`ctx.browserUse`）与 Computer Use（`ctx.computerUse`）**：
  - 两者都采用**独占具名提供方注册表**（防止同一配置树同时启用多个浏览器/桌面提供方造成工具冲突）；
  - 实验包已覆盖 **Playwright MCP、Chrome DevTools MCP、Stagehand**（Browser Use）以及原生 **CUA + Cua Driver**（Computer Use，带权限管理组合包），详见 [Browser Use 与 Computer Use](#/gui-automation/overview)。
- **Subagent 与 Agent Teams**：
  - `subagent` 接缝背后可以千差万别——既可以本地派生一个子 Agent，也可以把一轮任务委派给外部其他产品；
  - 根会话开启 **Agent Teams** 后，提供共享任务板与任务策略，配合普通 Subagent 控制工具实现身份、通信、发现、中断与收件箱等待。
