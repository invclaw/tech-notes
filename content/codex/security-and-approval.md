> [!FOCUS] 核心安全哲学
> Codex 面向“开发者本机写代码”场景，因此选择了**「三端原生进程沙箱（毫秒级低摩擦） + 网络代理过滤 + ExecPolicy 命令策略 + Guardian 自动/人工分级审批」**的组合拳，把“默认安全”与“不频繁打断开发者”平衡到极致。

## 1. 三端原生进程沙箱 + 网络代理

Codex 在三个桌面操作系统上全部做了原生进程级沙箱实现（底层内核原理详见 [AI Agent 沙箱技术全景 → 第 2 章](#/agent-sandbox/process-and-runtime)）：
- **macOS**：基于 XNU MAC 的 **Seatbelt**；
- **Linux**：内置 **`bwrap`（Bubblewrap）+ Landlock + Seccomp** 组合；
- **Windows**：专门维护了独立的 `windows-sandbox-rs` 与 `windows-sandbox-service`（基于 **AppContainer + Restricted Token + Job Object**）。

在权限档位上，Codex 提供直观的分级模式：
- **`read-only`**：只允许读取，禁止改写文件与联网；
- **`workspace-write`（主力档位）**：允许读写当前工作区与临时目录，屏蔽宿主机敏感目录，默认禁止外连网络；
- **`danger-full-access`**：显式放开限制（受控环境下使用）。

同时配套独立的 **`network-proxy`** 模块，实现“沙箱内进程禁止直连公网，但可按策略经本地代理访问白名单域名”的精细出站管控。

---

## 2. ExecPolicy 策略引擎与托管人工检查点

光靠沙箱挡不住“在工作区内部删库、强推分支或误跑危险脚本”。Codex 因此在执行前叠了一层**命令级静态策略引擎（`execpolicy`）**：

1. **命令规范化（Canonicalization）**：先解析命令行结构、还原可执行文件路径映射，防止模型用路径别名或花式拼接绕过规则；
2. **前缀规则匹配**：按命令前缀与精确路径优先级裁决——直接放行（免打扰）、拒绝、或要求审批；
3. **托管强制人工检查点（`prompt-user`）**：企业或管理员可在托管配置（`requirements.toml`）中把高危命令标为强制人工确认。**一旦命中此类规则，即使开启了自动审查、或者本会话之前已经给过“始终允许”，依然必须由人类做一次全新的显式确认**，且绝不允许被自动跳过。

---

## 3. Guardian 自动审查与工程隔离协作

- **Guardian 上下文审查（`guardian-context`）**：在“每条命令都弹窗问人（烦死人）”和“全自动放行（太危险）”之间引入智能审查层——结合当前任务上下文与安全边界自动评估风险，低风险操作无感放行，越界或高风险操作升级给人类拍板。
- **Git Worktree 隔离（`worktree`）**：支持为并行任务自动开辟独立的 Git Worktree 工作树，避免多个 Agent 任务同时改同一个工作目录互相踩踏。
- **多 Agent 协作底座**：仓库内已内置 `agent-roles`（角色定义）、`agent-graph-store`（Agent 协作关系图）与 `message-board`（异步消息板与 MCP 桥接），为复杂工程任务的多角色分工提供底层支撑。
