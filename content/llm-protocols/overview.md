> [!FOCUS] 为什么推理协议属于“Agent 基建”？
> 表面上看，调用大模型只是发一个 HTTP 请求；但在长程多工具 Agent 里，**底层推理协议直接决定了你能做到多低的延迟（Prompt Cache 命中率）、多稳的工具循环（流式事件与配对约束）、以及多优雅的上下文治理（服务端压缩与工具清理）**。

![三大主流大模型推理协议架构对比](./assets/llm-protocols-arch.svg)

## 三大主流推理协议全景横评

目前 AI Agent 生态事实上围绕三条协议演进：**OpenAI Chat Completions**（老牌行业最小公约数）、**OpenAI Responses**（新一代面向 Agent 的结构化协议）、以及 **Anthropic Messages**（强块模型与精细缓存控制）：

| 维度 | OpenAI Chat Completions | OpenAI Responses API | Anthropic Messages API |
|---|---|---|---|
| **核心数据模型** | 扁平 `messages[]` + 附挂 `tool_calls` | 类型化 **Item 列表**（`message`/`reasoning`/`function_call`/`compaction`） | 统一 **Content Block 数组**（`text`/`thinking`/`tool_use`/`tool_result`） |
| **状态与重传** | 完全无状态，每轮全量重传 | 支持无状态，也支持 `previous_response_id` 服务端状态链 | 无状态，但靠**显式缓存断点**避免重复计费与重算 |
| **思考块（Reasoning）** | 非标准扩展字段，各家实现不一 | 一等 `reasoning` Item，支持加密思考块跨轮续接 | 一等 `thinking` Block + 防篡改 `signature`，支持交错思考 |
| **流式事件模型** | 粗粒度 `choices[0].delta` 碎片拼接 | 细粒度语义状态机（`item.added` → `delta` → `item.done` → `completed`） | 细粒度块状态机（`content_block_start` → `delta` → `stop`） |
| **Prompt Caching** | 自动前缀缓存，粒度较粗 | 自动前缀缓存 + `prompt_cache_ttl` 提示 | **显式 `cache_control` 断点**（可精确打在系统/工具/历史，支持 5m/1h） |
| **服务端上下文治理** | 无（全靠客户端自行裁剪/总结） | **原生 `/responses/compact` 服务端压缩态** | **原生 `clear_tool_uses` 服务端工具结果清理** |
| **回合终止信号** | `finish_reason`（`stop` / `tool_calls` / `length`） | `response.completed` + 可选 **`end_turn: false`** 续跑信号 | `stop_reason`（`end_turn` / `tool_use` / `max_tokens` / `pause_turn`） |

## 在真实 Agent 中的落地映射

- **[Codex 架构设计解析](#/codex/overview)**：主力引擎深度绑定 [OpenAI Responses 协议](#/llm-protocols/openai-responses)，其 [远端压缩 V2 与后台投机预压缩](#/codex/core/compaction) 正是建立在 Responses 服务端压缩态之上；本地 Ollama / LM Studio 兼容层则走 Chat Completions。
- **[OpenClaw 架构设计解析](#/openclaw/overview)**：同时对接三套协议——在 [Agent Loop 续跑判定](#/openclaw/agent-loop) 中消费 Responses 的 `end_turn: false` 信号；在 [Session Pruning 与压缩](#/openclaw/agent-loop/compaction) 中，Anthropic 直连路由直接委托服务端 `clear_tool_uses`，OpenAI 直连路由则兼容 `/responses/compact`。
