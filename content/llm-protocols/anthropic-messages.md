> [!FOCUS] 核心定位
> **Anthropic Messages API（`/v1/messages`）** 是 Claude 全系模型的原生协议，也是 Claude Code 的底座。它在**强结构内容块模型、显式前缀 Prompt Caching 控制、以及服务端上下文清理**三件事上做得极其克制而锋利。

## 1. 统一 Content Block（内容块）数组模型

Anthropic 协议把每一条 `user` 或 `assistant` 消息的 `content` 统一建模为**有序的内容块数组**，天然支持多模态、思考与工具调用的自由混排：

- **`text`**：普通文本块；
- **`thinking`（带 `signature` 签名）**：模型的扩展思考块，附带服务端加密签名防客户端篡改；在多轮工具循环中支持**交错思考（Interleaved Thinking）**——模型每拿到一次工具结果，都能再思考一轮再决定下一步；
- **`tool_use` 与 `tool_result`**：严格要求角色交替与紧邻配对——`assistant` 发出 `tool_use` 块后，紧跟的下一条 `user` 消息开头必须包含对应 `tool_use_id` 的 `tool_result` 块（这也是 [OpenClaw Steer 跳过串行工具时必须补齐合成配对结果](#/openclaw/agent-loop) 的硬协议约束之一）；
- **清晰的 `stop_reason` 状态机**：`end_turn`（自然说完）、`tool_use`（请求执行工具）、`max_tokens`（撞输出上限）、`pause_turn`（长任务服务端主动暂停，提示客户端原样续跑）。

---

## 2. 显式 Prompt Caching（`cache_control` 前缀断点）

长程 Agent 的最大成本和延迟痛点，是每轮都要重复发送几万 token 的系统提示词、几十个工具定义和越来越长的历史记录。

Anthropic Messages API 没有只做黑盒自动缓存，而是把**显式缓存断点控制权（`cache_control: { type: "ephemeral" }`）**直接交给了开发者：
- 可以在 **System Prompt 末尾、Tools 定义末尾、以及历史对话的关键节点**精确打断点（支持 **5 分钟** 与 **1 小时** TTL）；
- 只要断点之前的字节完全不变，后续轮次直接命中缓存（大幅降低输入成本与首字延迟）；
- **对 Agent 架构的直接影响**：任何会偷偷改写早期历史前缀的操作（比如中途把旧图片替换成占位符、或频繁修改系统提示词），都会导致缓存从改动点往后全部失效！这也是 [OpenClaw](#/openclaw/agent-loop/compaction) 坚持“保留旧图片不动、等 Cache TTL 过期后再做客户端工具修剪”以及 [Codex](#/codex/core/compaction) 坚持“稳定前缀置顶 + `WorldState` 平时只追加 Diff”的共同底层原因。

---

## 3. 服务端上下文编辑（Context Management · `clear_tool_uses`）

针对长程工具循环里动辄暴涨的工具输出，Anthropic Messages API 原生提供了**服务端上下文编辑能力**（`clear_tool_uses`）：
- 客户端在请求参数里声明清理阈值（如输入超过多少 token 触发）、保留最近 N 次工具结果、以及单次最少清理多少 token 才动手（避免清得太少反而打废缓存不划算）；
- 服务端在推理前自动把早期工具结果替换成已清理标记，而**客户端本地磁盘里的完整历史毫发无损**；
- **[OpenClaw Session Pruning](#/openclaw/agent-loop/compaction)** 在 Anthropic API-key 直连路由上正是直接委托给了这套服务端清理机制，无需在客户端自己做软/硬裁剪。
