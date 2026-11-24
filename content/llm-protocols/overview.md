> [!FOCUS] 一句话看懂三大协议的演进
> 从 **Chat Completions**（老牌聊天补全，全行业通用）→ **Responses API**（OpenAI 新一代 Agent 协议，Item 化 + 服务端压缩）与 **Anthropic Messages**（强内容块模型 + 显式缓存断点 + 服务端工具清理），本质都是为了解决**长程多工具 Agent 的低延迟、思维链续接与上下文膨胀**问题。

![三大主流大模型推理协议架构对比](./assets/llm-protocols-arch.svg)

## 同一场景的字段级对照（核心差异一眼看清）

假设我们要做同一件事：**“发一个带工具的请求 → 模型思考并调用 `get_weather("上海")` → 客户端回传结果”**，三大协议在报文字段上的直接对照如下：

| 对比项 | OpenAI Chat Completions | OpenAI Responses API | Anthropic Messages API |
|---|---|---|---|
| **请求路径** | `POST /v1/chat/completions` | `POST /v1/responses` | `POST /v1/messages` |
| **系统提示词** | 混在 `messages[0]`（`role: "system"`） | 独立顶层字段 `instructions` | 独立顶层字段 `system`（可打缓存断点） |
| **历史输入载体** | 扁平 `messages[]`（每轮全量重传） | 类型化 `input[]`（可选 `previous_response_id` 增量续接） | `messages[]`（每条 `content` 为有序块数组） |
| **思考块（Reasoning）** | 无统一标准（各家私有扩展字段） | 独立 `type: "reasoning"` Item（支持加密续接） | 独立 `type: "thinking"` 块（附防篡改 `signature`） |
| **工具调用参数** | `tool_calls[].function.arguments`（**JSON 字符串**，需二次反序列化） | 独立 `type: "function_call"` Item（JSON 字符串） | 独立 `type: "tool_use"` 块（**原生 JSON 对象** `input`） |
| **回传工具结果** | `role: "tool"` + `tool_call_id` | `type: "function_call_output"` + `call_id` | `role: "user"` 内嵌 `type: "tool_result"` + `tool_use_id` |
| **流式 SSE 事件** | 只有统一 `choices[0].delta` 碎片 | 语义事件：`output_item.added` / `*.delta` / `response.completed` | 块事件：`content_block_start` / `delta` / `stop` |
| **结束判定标志** | `finish_reason`: `stop` / `tool_calls` / `length` | `response.completed` + 可选 `end_turn: false` | `stop_reason`: `end_turn` / `tool_use` / `max_tokens` / `pause_turn` |
| **Prompt Cache** | 服务端自动前缀缓存 | 服务端自动缓存 + `prompt_cache_ttl` | **显式 `cache_control` 断点**（5m / 1h TTL） |
| **服务端上下文治理** | 无（全靠客户端） | **原生 `/responses/compact` 服务端压缩态** | **原生 `clear_tool_uses` 服务端清理旧工具结果** |

## 在真实 Agent 中的落地映射

- **[Codex 架构设计解析](#/codex/overview)**：主力引擎绑定 [OpenAI Responses 协议](#/llm-protocols/openai-responses)，其 [远端压缩 V2 与后台投机预压缩](#/codex/core/compaction) 直接建立在 `/responses/compact` 之上；本地 Ollama / LM Studio 兼容层走 [Chat Completions](#/llm-protocols/openai-chat-completions)。
- **[OpenClaw 架构设计解析](#/openclaw/overview)**：在 [Agent Loop 续跑判定](#/openclaw/agent-loop) 中消费 Responses 的 `end_turn: false`；在 [Session Pruning 与压缩](#/openclaw/agent-loop/compaction) 中，Anthropic 直连路由委托 [Anthropic Messages](#/llm-protocols/anthropic-messages) 的服务端 `clear_tool_uses`，OpenAI 直连路由则兼容 `/responses/compact`。
- **越过 HTTP 协议边界往下看**：这些协议字段如何落入推理引擎的 Prefix Caching、连续批处理、受约束解码与 SSE 流式解析，详见 [大模型推理引擎解析：全景与物理模型](#/inference-engines/overview) 与 [三家引擎源码架构横评](#/inference-engines/three-engines-architecture)。
