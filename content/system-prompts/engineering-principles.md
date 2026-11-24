> [!FOCUS] 核心提炼
> 看完 OpenClaw、Codex、OpenCode、Pi 四家真实源码，可以抽取出编写工业级 Agent System Prompt 的**四条通用工程法则**——它们比任何“Prompt 技巧话术”都更直接地决定线上效果与成本。

![工业级 System Prompt 静动切分与 Prompt Cache 保护架构](./assets/prompt-cache-boundary.svg)

---

## 法则 1：死守 Prompt Cache 边界（静态在上，动态在下）

这是最容易被忽视、但对**延迟和成本影响高达 5–10 倍**的架构铁律（协议层详见 [Anthropic 显式缓存断点](#/llm-protocols/anthropic-messages) 与 [OpenAI Responses 前缀缓存](#/llm-protocols/openai-responses)，推理引擎 KV Cache 链式哈希 / Radix Tree 物理机制详见 [KV Cache 与 Prefix Caching 原理](#/inference-engines/kv-cache-and-prefix)）：

- **绝对禁止**把会随每轮变化的内容（当前精确到秒的时间戳、实时活跃进程列表、刚刷新的动态记忆、临时状态计数）插在 System Prompt 开头！只要第 100 个字节变了，后面几万 token 的缓存就全部失效重算；
- **正确做法**（OpenClaw 与 Codex 的共同范式）：
  1. **最顶部**：跨轮字节级不变的基础指令、固定策略与工作区常驻文档；
  2. **中间/缓存边界之下**：偶尔变更的工具目录与环境说明；
  3. **对话尾部 / 独立 `Runtime Context` 载体**：日期时间、当前运行中的后台命令、子 Agent 进度等每轮都在变的实时快照，或者像 Codex [`WorldState`](#/codex/core/compaction) 那样平时只追加 Diff、不改旧前缀。

---

## 法则 2：按模型家族对症下药，拒绝“一份提示词打天下”

不同模型家族的后训练偏好差异巨大：
- **对强 Agent 后训练模型（如 Claude / Codex 专属模型）**：**做减法**。冗长的说教和互相冲突的细则反而稀释注意力，只需写清“项目硬规范 + 工具边界 + 极简风格要求”；
- **对偏对话/偏保守的通用模型**：**显式补齐行为契约**——包括“并行调用独立工具”“工具返回弱结果时主动换策略重试”“区分阶段性同步与最终交付”“不把 `running` 汇报成已完成”。

---

## 法则 3：把安全留给沙箱，把“行动偏置”留给提示词

很多自研 Agent 跑起来特别“磨叽”——改一行代码先问三遍、遇到一点小报错就停下来让用户自己修。根源往往是把本该由代码兜底的安全担忧全写进了提示词（“做任何事之前都要小心询问用户”）：
- **硬边界（能不能做）**交给 [沙箱](#/agent-sandbox/overview) 与权限审批引擎；
- **提示词（怎么做好）**则明确告知模型当前权限边界（规划对齐），并在授权范围内给予清晰的**行动偏置（Execution Bias）**：遇到可执行任务直接端到端推进直到完成或真正阻塞，不要半途而废，也不要在已有权限内反复客套请示。

---

## 法则 4：长手册与 Skills 按需延迟加载（Progressive Disclosure）

不要把 50 个技能说明书、几百页文档全塞进 System Prompt：
- **启动时只放极简目录（名称 + 一句话触发条件）**，让模型知道“我有这项能力”；
- 只有当当前任务真正命中某个技能时，再由模型按需读取完整 `SKILL.md` 正文（OpenClaw、Codex、OpenCode、Pi 四家在这一条上达成了 **100% 一致**）。
