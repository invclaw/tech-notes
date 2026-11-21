> [!FOCUS] 历史地位
> **OpenAI Chat Completions（`/v1/chat/completions`）** 是整个大模型行业的“TCP/IP 最小公约数”。哪怕你用的是开源模型（vLLM / SGLang / Ollama）、云中转网关或各家国产大模型，几乎全部原生兼容这套协议。

## 1. 核心数据与交互模型

它的设计诞生于“多轮聊天机器人”时代，结构极其简单直观：
- **完全无状态（Stateless）**：服务端不保存对话历史，每次请求客户端都把完整的 `messages` 数组（`system` / `user` / `assistant` / `tool`）全量发过去；
- **工具调用方式**：模型在 `assistant` 消息上附挂一个 `tool_calls` 数组（含 `id`、工具名、JSON 字符串参数）；客户端执行完后，追加对应 `role: "tool"` + `tool_call_id` 的结果消息，再发下一轮请求；
- **流式传输与结束判定**：SSE 持续推送 `choices[0].delta` 碎片（文本和函数参数字符串被拆成碎片，客户端自行拼接），最后以 `finish_reason` 结束：
  - `stop`：模型自然说完；
  - `tool_calls`：模型请求执行工具；
  - `length`：撞到最大输出 token 上限被截断。

---

## 2. 为什么它在现代长程 Agent 场景下显得吃力？

当 Agent 从“单轮问答”演进到“连跑 40 轮工具、深度推理、多模态交互”后，Chat Completions 暴露出四个结构性短板：

1. **没有标准的“思考块（Reasoning）”模型**：推理模型（o1/o3/DeepSeek-R1 等）出现后，思考过程只能靠各家私有的 `reasoning_content` 等非标准字段硬塞，跨工具轮次如何回传、如何防止思考被篡改没有统一契约；
2. **工具调用碎片拼装脆弱**：流式阶段工具参数是散落的 JSON 字符串碎片，一旦在 `length` 截断或流中断时，客户端极易拿到半截非法 JSON（这也是 [OpenClaw Agent Loop](#/openclaw/agent-loop) 专门做了“输出上限截断工具调用缓控与恢复”的原因）；
3. **缺乏原生服务端上下文治理**：没有服务端工具清理、也没有服务端压缩检查点，所有瘦身与压缩工作必须 100% 落在客户端自己实现（如 [OpenClaw 的客户端 `cache-ttl` 修剪与四段配额摘要](#/openclaw/agent-loop/compaction)）；
4. **语义表达单一**：一条消息很难清晰地把“思考 → 文本进度 → 多次工具调用 → 多模态产物 → 压缩检查点”作为平等的一等结构化对象表达出来。

> [!TIP] 现实选型建议
> 如果你的 Agent 需要**开箱兼容一切本地模型（Ollama / LM Studio）和第三方聚合网关**，Chat Completions 依然是不可替代的兜底协议；但只要对接官方前沿 Agent 模型，主流框架（[Codex](#/codex/overview)、[OpenClaw](#/openclaw/overview)）都会优先升级到 **Responses API** 或 **Anthropic Messages API**。
