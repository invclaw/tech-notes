> [!FOCUS] 一个非常值得借鉴的协议设计：带外元数据（零前缀污染）
> 很多框架想把“当前装了哪些插件、完整会话日志、遥测会话 ID”传给自家模型服务端时，容易把这些信息塞进 System Prompt 或消息里——结果**既多花了输入 Token，又把 Prompt Cache 打废了**。DeepSeek Harness 在 `dsh-llm-deepseek` 里展示了教科书级的**带外协议扩展（Wire Extensions）**做法。

---

## 1. 核心原则：放在 `messages` 与 System Prompt 之外

所有 DSH 专用扩展（HTTP 标头 + 保留 `dsh_` 前缀的顶层 JSON 字段）都严格位于 `messages`、系统提示词和工具 Schema **之外**：
- **不增加 1 个模型输入 Token**；
- **绝不改变模型可见前缀**，完全不影响 Prompt Cache 命中（对比 [大模型推理协议解析](#/llm-protocols/overview)）；
- 提供方无关的通用适配层（如 `llm-pi-ai`）不实现这些扩展，保持跨模型中立。

---

## 2. 两大核心带外正文扩展

### ① `dsh_plugin_packages`（存活插件包清单）
在每次发往 DeepSeek 官方端点的请求体顶层，附带当前宿主树中实际存活的插件包 `(name, version)` 去重排序列表（不含禁用、失败或松散模块），且自身持有独立 `version` 演进：

```json
{
  "dsh_plugin_packages": {
    "version": 1,
    "packages": [
      { "name": "@deepseek-ai/dsh-example", "version": "0.1.1-rc.2" }
    ]
  }
}
```

### ② `dsh_session_log`（带水位线的增量会话日志）
把权威的 `SessionEvent` 持久日志以**增量后缀**方式同步给服务端：
- 维护每个会话的最大已接受序号水位（`afterSeq` → `throughSeq`），首次上传 `afterSeq: -1`，之后每次只传新增事件；
- 单次受 `maxBytes`（默认 8 MiB）上限保护，超限自动分批在后续请求中续传；
- **两段式事务接受（`accept()`）**：只有收到端点 HTTP 2xx 响应后才推进水位线；如果传输失败或非 2xx，水位线回退不变，下一次请求自动重发未接受后缀；而且**任何扩展准备失败或序列化异常，都只会优雅降级省略扩展字段，绝不阻塞正常的模型推理请求**。

---

## 3. 配套 HTTP 标头规范

- `user-agent`：携带产品名、版本与当前启动的 Profile（如 `dsh-profile/desktop`、`dsh-profile/web`、`dsh-profile/sdk`）；
- `x-deepseek-harness-user-id`：已授权请求的稳定匿名 UUID；
- `x-deepseek-harness-session-id`：精确关联会话 ID；
- `x-deepseek-harness-compact: 1`：明确标识本次模型调用的用途是上下文压缩（便于服务端做针对性路由与统计）。
