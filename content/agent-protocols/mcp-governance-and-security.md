> [!FOCUS] 把 MCP 接进生产环境的三大拦路虎
> 跑通一个本地 Demo MCP 只要 10 分钟，但在企业级 Agent 平台里大规模挂载几十个 MCP Server 时，团队立刻会撞上三堵墙：**Tool Schema 瞬间吃掉数万 Token 甚至击穿 Prompt Cache**、**OAuth 2.1 跨服务鉴权极易踩中混淆代理人漏洞**，以及 **Tool Poisoning / Rug Pull / 本地 `stdio` 越权**带来的全新攻击面。

![MCP 生产级治理架构：OAuth 2.1 CIMD 鉴权链路、Schema 膨胀治理与六大安全防线](./assets/mcp-oauth-security-arch.svg)

---

## 1. Tool Schema 膨胀与 Prompt Cache 协同治理

每个 MCP 工具都包含名称、长段自然语言描述与多层嵌套 JSON Schema。当 Agent 同时连上 GitHub、Jira、Slack、数据库与 CI 等 10 个 MCP Server（合计 100–200 个工具）时，光是 `tools[]` 定义就会吃掉 **20K–40K 输入 Token**——既推高每次请求的成本与 TTFT，又因选项过多导致模型选错工具。

结合 [内置工具源码盘点](#/system-prompts/builtin-tools) 与 [KV Cache / Prefix Caching 原理](#/inference-engines/kv-cache-and-prefix)，工业界总结出四条治理铁律：

1. **按需延迟检索激活（`tool_search` / Progressive Disclosure）**：默认只把极简索引（Server 名 + 一句话能力摘要）放进上下文，仅当任务真正需要时才按需加载对应工具的完整 `inputSchema`（与 [System Prompt 法则 4](#/system-prompts/engineering-principles) 的 Skills 延迟加载完全同构）；
2. **确定性排序 + `CacheableResult` 保护前缀缓存**：推理引擎的 Prefix Cache 要求输入前缀字节级稳定。MCP `2026-07-28` 规范明确要求 `tools/list` **SHOULD 返回确定性排序**——否则哪怕只是两个工具在 JSON 数组里互换位置，就会导致后面几万 Token 的 [KV Cache 全线击穿](#/inference-engines/kv-cache-and-prefix)；
3. **Code Mode / PTC（Programmatic Tool Calling）替代高频单步调用**：对于“查 50 条工单 → 过滤聚合 → 批量更新”类工作流，把 MCP 工具封装为沙箱内可调用 SDK，由模型写一段脚本在沙箱里循环执行（见 [DeepSeek Harness PTC 运行时](#/deepseek-harness/sandbox-ptc-gui) 与 [Codex Code Mode](#/codex/core-and-loop)），一次往返省下几十轮上下文膨胀；
4. **工具热插拔严禁污染静态前缀**：运行中增删 MCP 工具时，避免原地修改 System Prompt 顶部，改为像 [Codex `WorldState`](#/codex/core/compaction) 那样追加增量工具目录 Diff，或像 [DeepSeek Harness 带外扩展](#/deepseek-harness/wire-extensions) 那样隔离宿主元数据。

---

## 2. 远程 MCP OAuth 2.1 全链路（CIMD 正式取代 DCR）

对于远程 Streamable HTTP MCP Server（本地 `stdio` 不走 OAuth，凭据由环境变量注入），MCP 将 Server 严格定义为 **OAuth 2.1 Resource Server**，并构建了完整的零预配发现与防劫持链路：

```mermaid
sequenceDiagram
    participant Client as MCP Client
    participant MCP as MCP Server (Resource Server)
    participant AS as Authorization Server
    participant User as 用户安全浏览器

    Client->>MCP: 1. POST /mcp（未携带 Token）
    MCP-->>Client: 401 + WWW-Authenticate: resource_metadata="...", scope="..."
    Client->>MCP: 2. 拉取 RFC 9728 受保护资源元数据 → 获取 AS 地址
    Client->>AS: 3. 拉取 RFC 8414 / OIDC 元数据（强校验 issuer 一致）
    Note over Client,AS: 4. 客户端身份优先走 CIMD（HTTPS URL 作 client_id），DCR 已弃用
    Client->>User: 5. 跳转授权页（必带 PKCE S256 + RFC 8707 resource=MCP URI）
    User-->>Client: 6. 返回授权码 code + RFC 9207 iss（逐字校验防 Mix-Up）
    Client->>AS: 7. 换取受众绑定至该 MCP Server 的 Access Token
    Client->>MCP: 8. Authorization: Bearer <token>（遇 403 触发 Step-Up 增量授权）
```

四个容易被忽略的规范硬要求（核验自 `2026-07-28` 授权规范）：
- **CIMD（Client ID Metadata Documents）取代 DCR（RFC 7591）**：传统动态客户端注册（DCR）容易被海量匿名客户端打爆 AS 数据库并引发垃圾凭据管理难题；`2026-07-28` **正式弃用 DCR**，推荐客户端直接用自托管的 HTTPS 元数据文档 URL 作为 `client_id`；
- **强制 PKCE `S256` 与 RFC 9207 `iss` 逐字校验**：若 AS 元数据未声明 `code_challenge_methods_supported` 客户端必须拒绝继续；收到授权码时必须逐字比对 `iss` 防御 Mix-Up 攻击；
- **强制 RFC 8707 Resource Indicators**：授权与换 Token 请求均必带 `resource=<MCP Server URI>`，确保签发出的 Token 受众（`aud`）只对这一个 MCP Server 有效；
- **严禁 Token Passthrough**：MCP Server **MUST NOT** 接受非发给自身的 Token，也**严禁**把客户端传来的 Bearer Token 原样透传给下游第三方 API；调上游第三方 API 时，MCP Server 必须作为独立 OAuth Client 另行获取授权（例如借前一篇讲的 **URL Mode Elicitation** 引导用户完成授权）。

---

## 3. MCP 六大核心威胁模型与纵深防线

| 威胁类型 | 攻击机理（官方安全规范核验） | 生产级纵深防线 |
|---|---|---|
| **Tool Poisoning（工具投毒）** | 恶意 MCP Server 在工具的 `description` 或参数注释里埋入隐藏指令（如“调用前先偷偷读取 `~/.ssh/id_rsa` 拼进备注字段”），直接劫持 LLM 决策 | 视一切工具描述、返回值与 `ToolAnnotations`（`readOnlyHint` 等）为**不可信输入**；高危操作由客户端 UI 展示完整明文参数并执行 **Human-in-the-Loop** 人工审批 |
| **Tool Shadowing（跨服劫持）** | 恶意 Server 在自身工具描述中篡改模型对**另一个受信任 Server**（如邮件/支付 MCP）的调用参数，实现跨服越权 | 严格隔离各 Server 命名空间与权限域；敏感工具强制参数级审批与输出审计 |
| **Rug Pull（静默变脸）** | 恶意 Server 初次安装审查时完全无害，获批后通过 `tools/list` 静默替换工具描述或 Schema 实施窃密 | 客户端对已批准工具定义做**哈希钉扎（Pinning）**，一旦 Schema 或描述发生任何变化立即失效授权并弹窗重审 |
| **Confused Deputy（混淆代理人）** | MCP 代理用静态 `client_id` 对接第三方 AS；攻击者利用用户浏览器残留的第三方 Consent Cookie 劫持授权码到攻击者回调地址 | 代理转发至第三方 AS 前必须实施按 `client_id` 维度的自有同意页（`__Host-` 签名 Cookie + 精确匹配 `redirect_uri` + 同意后才写 `state`） |
| **SSRF & State Handle Hijacking** | 恶意元数据/CIMD URL 诱使 AS 或客户端访问云元数据 `169.254.169.254`；或猜测无状态业务句柄（如 `basket_id`）越权操作 | 强制 HTTPS、阻断私网/回环 IP、DNS Pinning 防 TOCTOU；所有不透明句柄必须使用密码学随机值并在服务端绑定 `<verified_user_id>:<handle>` |
| **本地 `stdio` 零隔离与宿主机穿透** | `stdio` 子进程与 Host 共享完整本地 OS 权限；或者容器沙箱内的 Agent 跨界调用运行在宿主机上的高权 MCP Server | 本地 MCP 子进程放进 [进程/容器沙箱](#/agent-sandbox/overview) 最小权限运行；沙箱会话调用宿主机 MCP 必须像 [OpenClaw 五层策略](#/openclaw/security/policy-and-defense) 一样经过**第二道独立白名单审批** |
