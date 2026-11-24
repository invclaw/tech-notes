> [!FOCUS] 2026 年 MCP 最大范式剧变：告别有状态握手，全面转向无状态云原生
> 网上绝大多数教程仍停留在 2025 年的 MCP（必须三段 `initialize` 握手、靠 `Mcp-Session-Id` 维系内存会话、服务端经长连接 GET SSE 主动反推请求）。但官方最新稳定规范 **`2026-07-28`**（核验自 `b0be8f0f`）完成了一次彻底的云原生重构：**全面无状态化、纯 POST 单端点 Streamable HTTP、L7 网关路由镜像头、MRTR 反问机制，以及正式弃用 Roots / Sampling / Logging**。

![MCP 2026-07-28 架构大重构：无状态 Streamable HTTP、L7 镜像头与 MRTR 交互模型对照](./assets/mcp-stateless-mrtr-arch.svg)

---

## 1. 角色隔离边界与两代生命周期对照

MCP 架构由三类角色构成：**Host**（LLM 应用容器，掌控安全策略与用户同意）、**Client**（Host 内与 Server 保持严格 1:1 关系的连接器）与 **Server**（提供工具/资源/提示词）。协议守住一条核心隐私红线：**Server 绝不能读取完整对话历史，也不能窥视同 Host 下的其他 Server**。

理解现代 MCP，必须先分清 **Legacy（`2024-11-05` ~ `2025-11-25`）** 与 **Modern（`2026-07-28` 起）** 的代际差异：

| 维度 | Legacy 时代（`<= 2025-11-25`） | Modern 时代（`2026-07-28`，SEP-2567 / SEP-2575） |
|---|---|---|
| **连接建立与会话** | 强制三段握手：`initialize` → `InitializeResult` → `notifications/initialized`；HTTP 依赖 `Mcp-Session-Id` 粘性会话 | **彻底无状态（Stateless）**：移除 `initialize`、`initialized`、`ping` 与 `Mcp-Session-Id`，无连接级状态，任意无状态副本/Serverless 可直接接单 |
| **版本与能力携带** | 仅在握手时交换一次并缓存在连接态 | **每条请求自包含于 `params._meta`**：必带 `io.modelcontextprotocol/protocolVersion` 与 `clientCapabilities`（兼容 OpenTelemetry `traceparent`/`tracestate`） |
| **发现与版本协商** | `initialize` 响应回退版本 | Server **MUST** 实现 **`server/discover`**；Client 亦可直接调 RPC，遇规范错误码 **`-32022`**（附 `supported` 列表）后自动重试 |
| **Streamable HTTP 形态** | 单端点同时支持 POST + 长连接 GET SSE + DELETE，依赖 `Last-Event-ID` 断线续传 | **收束为纯 POST 单端点**（GET/DELETE 返 `405`），移除 `Last-Event-ID`；长连接推送改为 **`POST subscriptions/listen`**；关闭 SSE 流本身即取消 |
| **L7 网关可观测性** | 网关看不见 JSON Body 里的工具名，难以按工具限流/路由 | **强制 HTTP 镜像头（SEP-2243）**：`Mcp-Method`、`Mcp-Name` 与 `x-mcp-header` 标注的 `Mcp-Param-{Name}`；Server **MUST** 校验与 Body 一致，否则拒收 **`-32020`** |

> [!TIP] `stdio` 与 `Streamable HTTP` 怎么选？
> - **`stdio`（NDJSON 换行定界）**：适合本地 CLI 工具，但官方安全文档明确强调 **`stdio` 不是沙箱**，子进程与客户端共享同一 OS 权限域；
> - **二代 `Streamable HTTP`**：远程与多租户生产首选。强制校验入站 `Origin` 头（无效返 `403` 防 DNS Rebinding），本地调试仅绑定 `127.0.0.1`。

---

## 2. 三大服务端原语与 `CacheableResult`

| 原语 | 控制方 | 核心 RPC 与 `2026-07-28` 关键特性 |
|---|---|---|
| **Tools** | **模型控制**（Model-Controlled） | `tools/list`（**SHOULD 返回确定性排序以保护 LLM Prompt Cache**）、`tools/call`。默认 JSON Schema 2020-12（禁止自动拉取网络 `$ref` 防 SSRF）；支持 **`outputSchema` + `structuredContent`**（放宽为任意 JSON 值）；双轨错误区分协议错误（JSON-RPC `error`）与工具业务错误（`result.isError: true`，供 LLM 自纠）；提供 `ToolAnnotations`（`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`，**客户端必须视作不可信输入**） |
| **Resources** | **应用驱动**（Application-Driven） | `resources/list`、`resources/read`（文本或 base64 `blob`）、`resources/templates/list`（RFC 6570 URI 模板）。变更订阅迁移至 `POST subscriptions/listen`；资源不存在改返标准 `-32602` |
| **Prompts** | **用户控制**（User-Controlled） | `prompts/list`、`prompts/get`（渲染返回带角色消息数组，常映射为 UI Slash Command） |

**全局缓存规范（SEP-2549）**：`2026-07-28` 要求 `server/discover`、全部 `*/list` 与 `resources/read` 的成功响应 **MUST** 返回 `resultType: "complete"` 及 **`CacheableResult`（`ttlMs` + `cacheScope: "public" | "private"`）**，与 `listChanged` 推送失效互补。

---

## 3. MRTR 反问机制、Elicitation 与核心瘦身

无状态服务端不再拥有持久下推通道，那么工具执行到一半需要向用户要参数或授权怎么办？`2026-07-28` 给出的答案是 **MRTR（Multi Round-Trip Requests，SEP-2322）**：

1. **废除服务端主动 Request**：Server 收到 `tools/call` 后，不再反向发 JSON-RPC Request，而是直接返回 `resultType: "input_required"`，内含 `inputRequests` 与可选不透明 **`requestState`**；
2. **客户端完成交互并换新 ID 重试**：Client 完成表单录入或外部认证后，以**新的 JSON-RPC `id`** 重发原请求，附上 `inputResponses` 并原样回传 `requestState`（Server **MUST** 用 HMAC/AEAD 保护 `requestState` 完整性并绑定用户主体与短 TTL）；
3. **核心客户端原语瘦身（SEP-2577）**：
   - **`Elicitation`（`elicitation/create`）成为唯一活跃的核心客户端原语**：支持 **Form Mode**（扁平基础类型表单，**严禁**索要密码/API Key）与 **URL Mode**（跳出至系统安全浏览器页完成敏感录入或第三方 OAuth，彻底杜绝凭据经手 MCP Client）；
   - **`Roots`、`Sampling`、`Logging` 正式进入弃用期**（至少 12 个月窗口，最早 `2027-07-28` 移除）：官方建议目录改由参数/Resource 传、Server 自行直连 LLM API、日志走 `stderr` 或 OpenTelemetry；
   - **`Tasks` 异步长任务移出核心成为官方扩展 `io.modelcontextprotocol/tasks`（SEP-2663）**：改为服务端主导，精简为 `tasks/get` 轮询 + `tasks/update` 提交中途输入 + `tasks/cancel` 五态状态机（`working` / `input_required` / `completed` / `failed` / `cancelled`）。

---

## 4. 规范核验最小 Wire 示例（`2026-07-28`）

### 示例 A：`tools/call` + L7 路由镜像头 + `structuredContent`

```http
POST /mcp HTTP/1.1
Host: example.com
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: get_weather_data
```

```json
// Client -> Server
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "get_weather_data",
    "arguments": { "location": "New York" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}

// Server -> Client
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "resultType": "complete",
    "content": [
      { "type": "text", "text": "{\"temperature\": 22.5, \"humidity\": 65}" }
    ],
    "structuredContent": { "temperature": 22.5, "humidity": 65 }
  }
}
```

### 示例 B：MRTR 人机交互 `elicitation/create` 往返

```json
// 1) Server -> Client: 返回 input_required + 签名保护的 requestState
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "resultType": "input_required",
    "inputRequests": {
      "github_login": {
        "method": "elicitation/create",
        "params": {
          "mode": "form",
          "message": "Please provide your GitHub username",
          "requestedSchema": {
            "type": "object",
            "properties": { "name": { "type": "string" } },
            "required": ["name"]
          }
        }
      }
    },
    "requestState": "eyJsb2NhdGlvbiI6Ik5ldyBZb3JrIn0..."
  }
}

// 2) Client -> Server: 必须换新 id 重试，携带 inputResponses 与原样 requestState
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": { "location": "New York" },
    "inputResponses": {
      "github_login": { "action": "accept", "content": { "name": "octocat" } }
    },
    "requestState": "eyJsb2NhdGlvbiI6Ik5ldyBZb3JrIn0...",
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": { "elicitation": { "form": {} } }
    }
  }
}
```
