> [!FOCUS] 为什么 Codex 的压缩机制值得单独精读？
> 普通 Agent 的压缩往往只是“快满时让模型总结一下”，结果经常出现**压缩本身溢出报错、压完把刚到的用户输入吞了、压完忘记当前环境状态、或者压缩卡住用户几十秒**。Codex 针对这些真实痛点，设计了一套包含**三条压缩路线、后台投机预压、五层窗口重建与原子持久化**的工业级压缩体系。

![Codex 上下文压缩架构全景](./assets/codex-compaction-arch.svg)

---

## 1. 什么时候触发压缩？三条路线怎么选？

Codex 将压缩建模为与普通工具调用同等地位的一等生命周期事件（统一触发 `PreCompact` / `PostCompact` 钩子、发出 `ContextCompaction` 进度条目、并递增上下文窗口编号）。触发来源分为**用户手动触发（`/compact`）**、**行内自动触发（接近预算阈值或溢出补救）**和**回合后自动触发（Post-Turn）**。

底层提供**三条压缩路线**：

| 压缩路线 | 核心机制 | 近期消息保留预算 | 适用场景 |
|---|---|---|---|
| **路线 A：远端压缩 V2（主力）** | 基于 [OpenAI Responses 协议](#/llm-protocols/openai-responses) 的服务端专用压缩能力，返回服务端结构化压缩态（而非客户端拼接纯文本），并支持**后台投机预压缩** | 最高约 **64,000 tokens** | 官方 Responses API 长程 Coding 任务主力方案，精度最高、等待最短 |
| **路线 B：本地模型摘要压缩** | 将当前历史 + 摘要提示词发给模型，生成结构化交接总结，附带“前缀裁剪溢出自救” | 最高约 **20,000 tokens** | 兼容非官方/本地模型或不支持远端压缩的场景 |
| **路线 C：令牌预算直接开新窗** | 跳过模型/服务端总结，直接安装全新上下文窗口，但完整走相同的 `Pre/PostCompact` 钩子与事件流 | 仅重置新窗口 | 对压缩延迟极敏感、不需要摘要总结的场景 |

---

## 2. 最核心的工程亮点：后台投机预压缩（Speculative Background Compaction）

长程任务里，用户最烦的就是聊到一半突然卡住 20 秒显示“正在压缩上下文”。Codex 的远端压缩 V2 引入了**后台投机预压缩**来消除这种卡顿：

1. **提前异步预压前缀**：在上下文接近阈值但还没彻底爆掉前，系统截取当前历史前缀（`CompactionPrefix`）与当前世界状态快照，在后台静默发起一次远端压缩，产出一份**后台候选结果**（附带生成时的模型标识与配置哈希），完全不阻塞前台对话；
2. **触线瞬间秒级采纳（Adopt）**：等真正需要切换新窗口时，先校验当前模型与压缩配置哈希是否和候选一致：
   - **校验通过**：直接采纳后台预压好的前缀，再把预压期间新产生的最新对话尾巴接在后面——用户几乎零等待；
   - **拼接尾巴后仍超预算 / 候选因切模型失效**：无缝回退触发一次**前台同步压缩**兜底，绝不把超限历史硬塞给模型。

---

## 3. 本地压缩的“溢出自救”机制

如果走本地模型摘要路线时，当前历史已经大到连**压缩请求本身都触发了 `ContextWindowExceeded`** 怎么办？

Codex 的做法非常克制而有效：
- **从最老的历史条目开始逐条裁剪重试**，而不是一刀切丢掉最近对话；
- 这样既能最大限度**保住最新的代码修改与报错上下文**，又顺带保护了前缀缓存结构，直到压缩请求能成功落入模型窗口内；同时对网络流错误遵循退避与 `Retry-After` 重试预算。

---

## 4. 压缩后，新上下文窗口到底保留什么、丢弃什么？

很多 Agent 压缩后变“傻”，是因为把不该丢的丢了、或者把过期的环境描述又带进了新窗口。用一个真实排障场景来直观对比——假设你让 Codex 排查一个登录接口 500 报错，它连续读了 15 个文件、跑了 8 轮测试，上下文塞到 ~180K tokens 触发压缩，压缩前后每一块内容的去向如下：

![实例对照：压缩前 vs 压缩后上下文窗口五层重建](./assets/codex-compaction-example.svg)

对照上图，Codex 在重建新上下文窗口时严格按**五层结构**重新拼装：

1. **① 稳定前缀置顶（保 Prompt Cache）**：把基础指令与跨轮不变的稳定前缀放在最顶部，确保新窗口从第一轮就能吃满模型服务端缓存；
2. **② 重新渲染最新 World State**：**绝不沿用压缩前老旧的环境描述**，而是按当前最新状态重新渲染工作区、工具清单与角色名录，并把当前状态快照记录为新窗口的比较基线；
3. **③ 压缩摘要 / 服务端压缩态**：用浓缩后的历史摘要或服务端结构化压缩项替代早期海量过程日志；
4. **④ 跨窗口硬保留物（防关键信息丢失）**：
   - **近期真实用户消息**：在预算内（本地 20K / 远端 V2 64K）原样保留最近的真实用户输入，避免用户原始意图被二次摘要扭曲；
   - **标记为跨窗口保留的独立工具输出**：客户端主动写入或显式声明跨窗口保留的工具输出直接带入新窗口；
   - **多模态媒体预算控制**：对图片与音频单独施加预算上限，并替换已无法解析的过期媒体引用，防止几张大图瞬间撑爆新窗口；
5. **⑤ 挂起未处理输入（Pending Mail）精准归位**：
   - 压缩瞬间刚好到达、尚未回应的新输入不会被摘要吞掉；系统按原始历史序号重新排序去重，并把**压缩摘要精准插在这些未处理输入之前**，确保每条新输入既不会丢失、也不会重复出现两次。

### 4.2 完整实例：压缩后发给大模型的实际消息序列长什么样？

把上面五层拼在一起，压缩完成后下一轮真正发给大模型的消息数组大致如下（每块标明了对应层级）：

```xml
==================== ① 稳定前缀（置顶，保 Prompt Cache） ====================
[role: developer / base_instructions]
You are Codex, a coding agent...（核心系统提示词 + 工具规范，跨轮字节级不变）

==================== ② 重新渲染的最新 World State ====================
[role: developer]
<permissions instructions>
Workspace write.
Ask for approval.
</permissions instructions>

[role: user]
<environment_context>
  <environments>
    <environment id="laptop" primary="true">
      <cwd>/repo</cwd>
      <shell>zsh</shell>
    </environment>
  </environments>
  <current_date>2026-06-19</current_date>
  <network enabled="true"><allowed>api.internal.example</allowed></network>
</environment_context>

# AGENTS.md instructions
<INSTRUCTIONS>
Run pnpm test and pnpm lint before finishing.
</INSTRUCTIONS>

==================== ④ 跨窗口硬保留物（按预算原样保留） ====================
[role: tool_output · retain_across_windows=true]（独立保留工具输出）
name: "check_release_policy"
output: "Production auth changes must keep backward compatibility with v1 JWT."

[role: user]（近期真实用户消息，20K/64K 预算内原话保留）
不要改数据库表结构，只修鉴权中间件，顺便把单测补齐。
[媒体裁剪示意：早期上传的 2 张报错大图若超媒体预算或引用已失效，会替换为占位说明，不撑爆新窗口]

==================== ③ 压缩摘要 / 服务端压缩态 ====================
[role: user / compaction_summary]（本地摘要形态；远端 V2 则为服务端结构化 Compaction Item）
Another language model started to solve this problem and produced a summary of its thinking process...
- 根因定位：登录接口 500 源于 auth.ts 中过期 token 未捕获异常。
- 已完成改动：已在 src/middleware/auth.ts 修复异常捕获，未触碰任何数据库表结构。
- 待办：补充 auth.test.ts 单元测试并跑通 pnpm test。
（注：之前 40 轮读 15 个文件、8 次冗长报错日志已全部丢弃）

==================== ⑤ 挂起未处理输入（Pending Mail，置于摘要之后） ====================
[role: user · history_sequence=89]
对了，顺便把 token 过期的错误码统一改成 401。
```

> [!TIP] 看懂这个排序的巧妙之处
> 1. **最上面是 ① 稳定前缀**：保证新窗口第一轮就吃满缓存；
> 2. **中间是 ② 最新环境 + ④ 硬保留物 + ③ 压缩摘要**：模型既拿到此刻真实环境、又不丢失你亲口说的硬约束和关键上下文；
> 3. **最末尾是 ⑤ 挂起未处理输入**：紧跟在压缩摘要之后，模型下一轮推理的注意力天然聚焦在“先回应你刚插进来的 401 错误码需求，再继续补单测”。

---

## 5. 深入理解：`WorldState` 里面到底装了什么？

上面第 ② 层提到“压缩时要丢弃旧的 `WorldState`、重新全量渲染一份最新的”。那么 `WorldState` 究竟是什么？

一句话概括：**`WorldState` 是 Codex 为大模型维护的「当前运行时世界全景快照」**——把会话期间所有可能动态变化、又必须让模型实时知晓的外部环境与能力事实，抽象成一组结构化板块，按**“开窗全量渲染 → 平时仅发增量 Diff → 压缩时弃旧重算新基线”**的方式同步给模型。

### 5.1 `WorldState` 包含的六大板块

| 板块 | 具体内容 | 为什么必须动态追踪？ |
|---|---|---|
| **1. 运行环境与后台命令会话** | 当前工作区路径、可用执行环境清单、以及当前仍在后台运行/挂起的命令会话列表 | 切目录、切远端环境、或后台起了长跑服务时，模型必须知道真实运行现场 |
| **2. 权限、沙箱与协作模式** | 当前沙箱与权限说明、审批/协作模式、实时语音连接状态等 | 用户中途可能放宽或收紧沙箱、切换协作模式，模型不能按 1 小时前的旧权限行事 |
| **3. 指令与规范层** | 按目录动态发现的 `AGENTS.md` 工程规范、托管开发者指令、当前模型专属指导与窗口预算提示 | 进入不同子目录或切换模型时，生效的规则和提示词指导会随之变化 |
| **4. 可用工具与模型目录** | 顶层工具列表（支持增量工具更新）、工具预算说明、可用模型目录 | MCP 或工具热插拔时，模型能即时感知新增或下线的工具 |
| **5. 插件与外部应用生态** | 已启用插件说明、已连接外部 App 说明，以及扩展自定义注入的状态段 | 插件或外部连接器状态变动后立即生效 |
| **6. 多 Agent 协作状态** | 多 Agent 模式开关、可用角色与委派提示 | 决定当前会话能否派生子 Agent 以及可调用哪些角色 |

### 5.2 为什么 `WorldState` 的更新机制与压缩是绝配？

1. **平时只发增量 Diff（保 Prompt Cache）**：只要某板块没变化，后续轮次**一字不发**；只有当权限、目录、后台命令或工具发生变化时，才把变化的那一小段增量（按 `Prefix` 置顶 / `Mergeable` 合并 / `Standalone` 独立三种放置策略）追加给模型。
2. **压缩时一键“去碎片化”**：跑了四五十轮后，旧窗口里往往散落着好几条过时的“切换目录 / 改权限 / 已结束的后台进程”增量；压缩时直接把这些历史碎片全丢掉，用此刻最新的 `WorldState` **重新全量渲染一份干净基线**放进新窗口，后续轮次再以这份新基线为起点继续做增量 Diff。

### 5.3 实例演示：一次真实对话里 `WorldState` 长什么样？

下面以一次真实排障会话的 4 个节点，直接看 Codex 实际喂给模型的 `WorldState` 内容（格式取自 Codex 真实渲染快照）：

**① 第 1 轮（开新会话：全量渲染初始基线）**
在你的第一句话之前，Codex 按不同角色注入当前完整世界状态：

```xml
<!-- role: developer（权限与审批策略） -->
<permissions instructions>
Read only.
Ask for approval.
</permissions instructions>

<!-- role: user（环境上下文：目录、Shell、日期、网络策略） -->
<environment_context>
  <environments>
    <environment id="laptop" primary="true">
      <cwd>/repo</cwd>
      <shell>zsh</shell>
    </environment>
  </environments>
  <current_date>2026-06-19</current_date>
  <network enabled="true"><allowed>api.internal.example</allowed></network>
</environment_context>

<!-- role: user（当前目录生效的仓库规范） -->
# AGENTS.md instructions
<INSTRUCTIONS>
Run unit tests with pnpm test before finishing.
</INSTRUCTIONS>
```
紧接着才是你的消息：`帮我排查登录接口 500 报错`。

**② 第 2 轮（环境、权限、规范都没变）**
- Codex 拿当前 `WorldState` 和上一轮基线比对：**全部一致 → 一字不发**，只追加你的新消息，前半段上下文 100% 命中服务端 Prompt Cache。

**③ 第 3 轮（中途你放开了写入权限，并更新了 `AGENTS.md`）**
- `WorldState` **只针对发生变化的两个板块**发送最小增量 Diff（未变化的 `cwd`、`shell` 不会重发）：

```xml
<!-- role: developer（仅权限变化，增量下发） -->
<permissions instructions>
Workspace write.
Ask for approval.
</permissions instructions>

<!-- role: user（规范变化，显式声明替换旧规范） -->
# AGENTS.md instructions
<INSTRUCTIONS>
These AGENTS.md instructions replace all previously provided AGENTS.md instructions.

Run pnpm test and pnpm lint before finishing.
</INSTRUCTIONS>
```
（如果某个旧环境断开或规范被删除，则会精准发一句 `<environment id="old" status="unavailable" />` 或 `The previously provided AGENTS.md instructions no longer apply.`，防止模型产生幻觉。）

**④ 第 40 轮（触发压缩：弃旧碎片，重算干净基线）**
- 前面几十轮散落在对话里的“只读权限 → 可写权限”、“旧版规范 → 新版规范”等历史增量碎片**全部丢弃**；
- Codex 用第 40 轮此刻的最新状态，在新窗口顶部重新全量渲染出一份**唯一、无冲突、干净的 `<permissions>` + `<environment_context>` + `<INSTRUCTIONS>`**，作为新窗口的起点。

---

## 6. 原子替换与持久化一致性

最后一步“安装新窗口”守住两条硬不变量：
- **内存与落盘字节级一致**：替换历史前统一为缺失项分配稳定 ID，随后把替换后的新历史、窗口编号、目标 ID 集合与压缩响应 ID 原子写入内存会话与磁盘 `Rollout` 日志——保证后续重启恢复、线程分叉（Fork）或回滚（Revert）时，读到的历史与运行态分毫不差；
- **Hook 可观测且可中止**：压缩前后的 `PreCompact` / `PostCompact` 钩子可以感知触发来源（手动/自动）并按策略决定继续或安全中止本轮。
