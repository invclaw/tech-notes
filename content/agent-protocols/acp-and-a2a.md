> [!FOCUS] 从“编辑器内实时结对编程”到“跨公司异步委派任务”
> MCP 管好了工具，但还缺两块关键拼图：**编辑器/IDE 如何无厂商锁定地挂载任意 Coding Agent？**（答案是 **ACP**）；**两个互不信任的外部系统 Agent 如何在不泄露内部 Prompt 与私有工具的前提下协同完成长时任务？**（答案是 **A2A**）。本篇结合官方最新 Schema（ACP `v1.35`/`v2-beta`、A2A `v1.0.1`）拆解两者细节，并映射回五大主流开源 Agent 的真实落地。

![ACP 会话流式交互模型与 A2A v1.0 不可变 Task 状态机对照](./assets/acp-a2a-protocol-flows.svg)

---

## 1. ACP（Agent Client Protocol）：Coding Agent 领域的 LSP

ACP 由编辑器与 Coding Agent 生态联合推动，目标与 LSP（Language Server Protocol）如出一辙：**让 N 个编辑器和 M 个 Coding Agent 从 `N × M` 私有适配变成 `N + M` 标准化对接**。

### 1.1 传输、会话周期与 19 种富语义流式事件
- **传输协议**：当前唯一标准化传输为 `stdio` 换行定界 JSON-RPC 2.0（NDJSON，`stderr` 仅打日志）；远程 **HTTP/2 Streamable HTTP**（`Acp-Connection-Id` / `Acp-Session-Id` + 长连接 GET SSE）与 **WebSocket Upgrade** 正处于 Draft RFD 阶段；
- **核心生命周期**：`initialize`（协商整型 `protocolVersion` 与能力）→ `session/new`（由编辑器注入工作区绝对路径 `cwd` 以及用户配好的 `mcpServers[]`）→ `session/prompt` → 持续接收 **`session/update`** 通知 → 回合结束或 `session/cancel` 中断；
- **UX-First 的 19 种 `session/update` 变体（v1）**：原生覆盖编码场景全部交互细节——正文/思考分片（`agent_message_chunk`/`agent_thought_chunk`）、工具调用与**内嵌 Diff 视图**（`tool_call_update` 内含 `{type: "diff", path, oldText, newText}` 与供编辑器跳转的 `locations[]`）、执行计划（`plan_update`）、上下文压缩进度（`compaction_update`）以及子 Agent 进度（`subagent_update`）。

### 1.2 反向能力与 v1 → v2 架构收敛
- **基线必填 HITL 审批**：`session/request_permission` 允许 Agent 在执行高危动作前弹出 `allow_once` / `allow_always` / `reject_once` / `reject_always` 选项交由用户决策；
- **v1 → v2 的关键减法**：ACP v1 提供可选反向 `fs/read_text_file`、`fs/write_text_file`（读取编辑器未保存缓冲区）与 `terminal/*` 托管终端；而 **`v2` 预览版（`v2.0.0-beta.4`）果断移除了反向 `fs/*` 与 `terminal/*`**，建议由编辑器侧通过标准 **MCP Server** 暴露文件和终端工具，同时把 `session/prompt` 改为异步接收确认模式（终态改由 `state_update` 通知汇报）——**让 ACP 彻底聚焦于人机交互会话，把工具执行还给 MCP**。

### 1.3 ACP 最小 Wire 示例（`v1` 核验）

```json
// 1. Client -> Agent: 发起编码回合
{"jsonrpc":"2.0","id":2,"method":"session/prompt","params":{"sessionId":"sess_abc123","prompt":[{"type":"text","text":"Enable debug mode in config.json"}]}}

// 2. Agent -> Client: 推送内嵌 Diff 的工具更新通知
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_abc123","update":{"sessionUpdate":"tool_call_update","toolCallId":"call_001","status":"completed","content":[{"type":"diff","path":"/repo/config.json","oldText":"{\"debug\": false}","newText":"{\"debug\": true}"}]}}}

// 3. Agent -> Client: 反向请求 HITL 审批
{"jsonrpc":"2.0","id":5,"method":"session/request_permission","params":{"sessionId":"sess_abc123","toolCall":{"toolCallId":"call_002"},"options":[{"optionId":"allow-once","name":"Allow once","kind":"allow_once"},{"optionId":"reject-once","name":"Reject","kind":"reject_once"}]}}
```

---

## 2. A2A（Agent2Agent Protocol v1.0.1）：跨组织黑盒协作标准

A2A 已于 2026 年 8 月纳入 Linux Foundation 旗下 AAIF 托管。它的第一性原理是 **Opaque Execution（不透明执行）**：当你的 Agent 委派外部财务、法务或云运维 Agent 干活时，双方处在完全不同的信任域，**绝不共享内部 Prompt、记忆库、模型选型或私有工具清单**，仅靠外部能力名片、消息与异步任务状态机协作。

### 2.1 `v1.0` 重大演进（对照早期 `v0.3` 资料）
1. **唯一规范源 `specification/a2a.proto`（ProtoJSON）**：一份 Protobuf 定义同时统领功能等价的 **JSON-RPC 2.0**、**gRPC** 与 **HTTP+JSON REST** 三种绑定，通过请求头 `A2A-Version: 1.0` 与多租户路径 `/{tenant}` 协同；
2. **标准化发现名片 `/.well-known/agent-card.json`**（取代旧版 `agent.json`）：以 `supportedInterfaces[]` 声明多种传输端点，`skills[]` 声明擅长技能，`securitySchemes` 对接 OAuth2 / OIDC / mTLS，并新增 **RFC 8785 + JWS 密码学签名**防篡改；
3. **终态不可变的 `Task` 状态机**：任务经 `TASK_STATE_SUBMITTED → WORKING`，中途可挂起至 `INPUT_REQUIRED` / `AUTH_REQUIRED` 等待人工补充信息或授权，最终落入不可变终态（`COMPLETED` / `FAILED` / `CANCELED` / `REJECTED`）。终态任务不可重启，后续迭代必须在同一 `contextId` 下新建 Task 并用 `referenceTaskIds` 关联；
4. **方法名与 `Part` 全面统一**：`v1.0` 将旧版 `message/send`、`tasks/get` 全面改为与 gRPC 一致的 PascalCase（`SendMessage`、`SendStreamingMessage`、`GetTask`、`ListTasks`、`CancelTask`、`SubscribeToTask`、`GetExtendedAgentCard`），并将 `TextPart`/`FilePart`/`DataPart` 合并为单一 `Part` `oneof { text | raw | url | data }`。

### 2.2 A2A `v1.0` 最小 Wire 示例（`AgentCard` 与 `SendMessage`）

```json
// GET /.well-known/agent-card.json
{
  "name": "Route Planner Agent",
  "description": "Calculates traffic-aware driving routes.",
  "version": "1.0.0",
  "supportedInterfaces": [
    {"url": "https://route.example.com/a2a/rpc", "protocolBinding": "JSONRPC", "protocolVersion": "1.0"},
    {"url": "https://route.example.com/a2a/rest", "protocolBinding": "HTTP+JSON", "protocolVersion": "1.0"}
  ],
  "capabilities": {"streaming": true, "pushNotifications": false},
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [{"id": "route-opt", "name": "Route Optimizer", "description": "Optimize route with traffic."}]
}
```

```json
// POST /a2a/rpc (Header: A2A-Version: 1.0)
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "msg-001",
      "role": "ROLE_USER",
      "parts": [{"text": "What is the weather today?"}]
    }
  }
}

// Response: 返回完整 Task 与产出 Artifact
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "task": {
      "id": "task-001",
      "contextId": "ctx-001",
      "status": {"state": "TASK_STATE_COMPLETED", "timestamp": "2026-11-24T03:00:00.000Z"},
      "artifacts": [{"artifactId": "art-001", "name": "Weather Report", "parts": [{"text": "Sunny, 24°C"}]}]
    }
  }
}
```

---

## 3. 五大主流开源 Agent 的协议落地映射

对照本知识库已完成源码剖析的五家主流 Agent，可以清晰看到工业界当前的真实协议采纳水位：**MCP 已是 100% 标配事实标准，ACP 正在成为 IDE 宿主统一接口，而 A2A 目前主要面向企业级跨组织平台，单机 Coding Agent 内部仍偏好更轻量的进程内/MCP 委派**：

| Agent 框架 | MCP 落地形态 | IDE / 宿主协议（ACP 或自研） | 多 Agent 协作与 A2A 状态 |
|---|---|---|---|
| **[OpenCode](#/opencode/server-and-ecosystem)** | 原生接入 MCP 并纳入统一通配符权限引擎（`allow`/`ask`/`deny`） | **原生实现 ACP 适配层**（支持 Zed 等编辑器直接挂载）+ 自有 HTTP/SSE Server | 通过 `@general` 子角色进程内协同，未引入重型 A2A |
| **[DeepSeek Harness](#/deepseek-harness/overview)** | 通过 Cordis 插件与能力接缝按需挂载 MCP（如 Playwright MCP） | **原生提供 `acp` Profile Bundle** 一键以 ACP Agent 形态接入宿主 | 内部靠 Event-Sourced Agent Teams 协作，外加 [零前缀污染带外扩展](#/deepseek-harness/wire-extensions) |
| **[Codex](#/codex/core-and-loop)** | 内置一等 MCP Client + `WorldState` 增量感知热插拔 + Plugin Host | 自研 **[App-Server JSON-RPC](#/codex/app-and-exec-server)**（与 ACP 定位高度对标，额外覆盖断线审批重放与 Exec-Server 远端执行） | 采用内部 `agent-roles` 与 `message-board` **MCP 桥接**（非 A2A） |
| **[OpenClaw](#/openclaw/security/policy-and-defense)** | MCP 与插件驻留 Gateway 宿主机，**沙箱会话跨界调用须过第二道白名单** | 单机单 **[Gateway 控制面](#/openclaw/overview)** 统一对接多渠道 IM 与桌面端 | 采用创建者归属的有界总控+专家路由（[Session 隔离](#/openclaw/sessions-and-agents)） |
| **[Pi](#/pi/extensions-and-isolation)** | 极简核心外置 **MCP + 全权 TS Extensions**（如经 MCP 挂载 GUI 自动化） | 以极简可嵌入 SDK + CLI/TUI 为主，按需经扩展桥接宿主 | 坚持极简底座，多 Agent 与持久化交由外部扩展按需组合 |
