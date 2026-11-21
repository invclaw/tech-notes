> [!FOCUS] 核心定位
> **OpenAI Responses API（`/v1/responses`）** 是 OpenAI 为替代 Chat Completions、专门面向 **长程、多工具、强推理 Agent** 打造的新一代统一协议，也是 [Codex 架构设计解析](#/codex/overview) 的核心推理底座。

## 1. 范式跃迁：从扁平消息数组 → 类型化 Item 列表

Responses API 最根本的变化是**放弃了“所有东西都塞进一条 chat message”的扁平设计**，把一次交互中的所有输入与产出都抽象成平等的**类型化 Item**：

- **`message`**：普通用户或助手文本/多模态消息；
- **`reasoning`**：一等推理思考项，支持服务端返回**加密思考状态（Encrypted Reasoning）**并在下一轮原样回传，实现多轮工具调用间的无损思维链续接；
- **`function_call` / `function_call_output`**：客户端工具调用与结果作为独立 Item 存在，不再附挂在文本消息上；
- **`compaction`**：**原生的服务端压缩状态项**，直接作为上下文历史中的合法一等对象，取代冗长的早期原始 Item。

---

## 2. 语义化流式事件机与 `end_turn` 信号

相比 Chat Completions 只能靠拼接 `choices[0].delta` 猜进度，Responses API 提供清晰的生命周期事件流：
- `response.created` → `response.output_item.added` → 各类精细 delta（文本增量 / 推理增量 / 工具参数增量）→ `response.output_item.done` → `response.completed`。
- **关键 Agent 信号：`end_turn: false`**：
  - 即使某次 `response.completed` 里只输出了一段纯文本（没有工具调用），只要服务端标记了 `end_turn: false`，就表示模型“只是先说了一段阶段性进展，本轮任务还没干完”，客户端应自动继续发起下一次请求。
  - 这正是 [OpenClaw Agent Loop 终止与续跑判定](#/openclaw/agent-loop) 中专门单独处理 `end_turn: false` 的协议根源。

---

## 3. 服务端状态链与原生压缩（`/responses/compact`）

Responses API 把过去完全由客户端硬扛的两件事搬进了协议原生能力：

1. **可选服务端状态续接（`previous_response_id`）**：客户端不必每次把几百 KB 历史从头传一遍，可直接基于上一次的响应 ID 增量追加新输入或工具结果（同时也完全兼容无状态全量传入模式）。
2. **原生服务端压缩（`/responses/compact`）**：
   - 客户端把膨胀的历史交给服务端专用压缩端点，服务端返回一份**精简保留窗口 + 加密压缩状态项（Compaction Checkpoint）**；
   - **[Codex 远端压缩 V2](#/codex/core/compaction)** 正是基于这套能力，进一步叠出了**后台投机预压缩（Speculative Background Compaction）**，让用户在长程写代码时几乎感受不到压缩卡顿；
   - **[OpenClaw 上下文压缩](#/openclaw/agent-loop/compaction)** 在 OpenAI API 直连路由上同样原生消费了 `/responses/compact`，但为了防止和插件自研的 `ContextEngine` 互相打架，专门设计了**压缩所有权保护**（且在 Memory Flush 记忆提取轮次强制禁用服务端压缩，确保记忆系统看到未摘要的完整原文）。
