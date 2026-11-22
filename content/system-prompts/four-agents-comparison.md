> [!FOCUS] 先破除一个常见迷思
> 网上常说“几个 Agent 性能差别全靠系统提示词”。**真实答案是：一半对，一半片面。**
> 系统提示词确实能显著拉开**执行干脆度、工具调用准确率、Prompt Cache 命中率与回复体感**；但真正拉开代差的不是“谁写的咒语更长”，而是**「按模型家族对症下药 × 缓存边界切分 × 工具/压缩/沙箱配合」**的系统工程。

![四大主流 Agent 系统提示词架构对比](./assets/system-prompt-arch.svg)

---

## 1. 四家真实源码级全景对比

直接对比 [OpenClaw](#/openclaw/overview)、[Codex](#/codex/overview)、[OpenCode](#/opencode/overview)、[Pi](#/pi/overview) 四个仓库的真实系统提示词实现，四家走出了四条截然不同的架构流派：

| 对比维度 | [OpenClaw](#/openclaw/overview)（精密分层派） | [Codex](#/codex/overview)（联合训练+增量派） | [OpenCode](#/opencode/overview)（因模施教派） | [Pi](#/pi/overview)（极简留白派） |
|---|---|---|---|---|
| **体量与风格** | 模块化中等体量（十余个固定语义段，按需开关） | 基础指令精炼 + 动态内容全拆进 `WorldState` | **按模型家族剧烈分化**：Claude 仅 **300B**，GPT **2.8KB**，Kimi/Meta 高达 **8–9KB** | **极简主义**：仅几条核心规则 + 每个启用工具 1 行简介 |
| **按模型家族定制** | Provider 插件可定向覆盖 `interaction_style` / `tool_call_style` / `execution_bias`（内置 GPT-5 行为契约） | 底层模型本身与 Codex 联合训练，高度内化 `apply_patch` 与 Responses 协议 | **最激进**：源码直接维护 `anthropic.txt` / `gpt.txt` / `kimi.txt` / `meta.txt` / `trinity.txt` 多套模板 | 几乎不做模型特化，依赖模型原生能力与用户扩展 |
| **Prompt Cache 保护** | 在系统提示词内部硬划**缓存边界**：大块静态前缀在上，动态工具/渠道在下，日期/进程移入独立 `Runtime Context` 载体 | 基础提示词作为 `Prefix` 置顶；动态变化通过 [`WorldState`](#/codex/core/compaction) 平时只追加 Diff | 静态系统模板 + 按启用工具动态拼接一次，尽量保持会话内不变 | 具名 XML Section 结构 + 完整 Skill 正文按需延迟加载 |
| **行动偏置（防偷懒/防瞎拒）** | **最明确**：单设 `Execution Bias` 与 `Promised Work`，明确告知“风险由运行时沙箱兜底，有工具就干到底、别瞎提前拒绝、别把 running 当完成” | 靠 [`<permissions instructions>`](#/codex/security-and-approval) 做规划对齐 + 独立 `update_plan` 与 `guardian` 审查提示 | 重点区分“中间解说（Commentary） vs 最终答复（Final Answer）”，要求并行调工具、遇 Steer 默认顺势融入 | 几乎不说教，只要求简洁与标清路径 |

---

## 2. 一个极具启发性的源码铁证：OpenCode 的“因模施教”

翻看 OpenCode 仓库的 `packages/core/src/plugin/system-prompt/`，你会看到一个非常反直觉、却极其真实的工程现象：
- **`anthropic.txt`（给 Claude）只有 300 字节**——几乎只叮嘱了一句“代码注释密度跟周围保持一致，别乱加注释”；
- **`gpt.txt`（给 GPT）有 2.8 KB**——重点教它“工作时在 Commentary 通道简短同步发现，别把追问放进解说里，独立工具尽量并行调，遇到用户中途 Steer 别推倒重来”；
- **`kimi.txt` / `meta.txt` / `trinity.txt` 涨到了 7.8–8.8 KB**——需要显式把更细的工具纪律、防偷懒约束和代码风格规矩写透。

**这说明了一个残酷却实用的规律：越强、越经过 Agent 后训练的模型，系统提示词越应该做减法；对尚未充分做过 Agent 纪律后训练的模型，提示词才需要显式补齐行为契约。**

---

## 3. 为什么光抄系统提示词，复现不了同样的效果？

1. **工具契约与提示词是绑定的**：Codex 的系统提示词之所以极短却极强，是因为底层模型在训练阶段就深度吃透了 `apply_patch`、Responses 加密思考块和 `WorldState`；把同一份提示词套给普通 `write_file` 工具，效果会大打折扣。
2. **缓存与压缩工程决定长程上限**：如果系统提示词写得再好，但每轮在开头拼一个当前时间戳把 [Prompt Cache](#/llm-protocols/anthropic-messages) 打废，或者聊 30 轮后压缩把关键约束丢了，体感照样会断崖式下滑。
3. **沙箱决定了提示词敢不敢放手**：OpenClaw 之所以敢在 `Execution Bias` 里明确告诉模型“别瞻前顾后反复请示、有工具就直接动手”，底气来自于它底层有**硬沙箱 + 5 层工具策略**兜底（见 [硬执行 vs 规划对齐](#/codex/security-and-approval)）。
