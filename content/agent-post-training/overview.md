> [!FOCUS] 静态权重文件是怎么从“随机乱码”炼成“会干活的 Agent”的？
> 前一专题 [大模型推理引擎解析](#/inference-engines/overview) 拆解了推理引擎如何把硬盘上静态只读的 `.safetensors` 权重文件变成高并发 API 服务。本专题再往下潜一层，回答三个根本问题：**静态权重如何生成？为什么强 Agent 后训练模型只需 300B 提示词而通用模型需要 8.8KB？以及工业界如何把 FSDP/Megatron 训练集群、vLLM/SGLang 推理集群与万级沙箱焊成一条高效 RL 流水线？**

![大模型静态权重诞生全链路：从随机初始化到预训练、SFT、RLVR 沙箱强化学习与联合训练](./assets/post-training-pipeline.svg)

---

## 1. 静态权重的四段诞生链路

硬盘上动辄几十到数百 GB 的 `.safetensors` 权重文件（外加 `config.json` 与 `tokenizer.json`），并非手写规则代码，而是数百亿至数千亿个浮点数在 GPU 集群上历经四个阶段迭代冻结的产物：

| 阶段 | 算力占比 | 训练目标与输入 | 产出能力边界 |
|---|---|---|---|
| **① 预训练（Pre-training）** | **90%+** | 从随机初始化白噪音出发，在数十万亿 Token 文本与代码上最小化下一个词预测误差（Next-Token Prediction） | 产出 **Base 基座权重**：将世界知识与代码模式压进矩阵，但只会续写，不懂多轮对话与工具调用 |
| **② 监督微调（SFT）** | ~1%–3% | 喂入人工或合成的高质量多轮“提问 → 思考 → 工具调用 → 回复”示范轨迹，做教师强制（Teacher Forcing）模仿 | 完成**格式冷启动**：学会 Chat Template、工具调用语法与基础推理范式；但缺乏失败纠错反馈，真实仓库遇陌生报错极易死循环 |
| **③ 沙箱强化学习（RLVR / GRPO）** | **5%–10%+（持续增长）** | 把模型直接放进真实代码/终端/桌面沙箱多轮试错，以**可验证环境真值**（单测通过、编译成功、状态断言）打分更新策略 | **真正内化 Agent 纪律**：自发学会并行调工具、遇到报错换策略、识别边界早停与抗幻觉 |
| **④ 剥离、量化与冻结导出** | <1% | 丢弃比权重本身大数倍的梯度与 AdamW 优化器状态，切分为 `.safetensors` 分片并可选校准量化为 FP8 / NVFP4 | 成为**只读静态权重文件**，交付给 [vLLM V1 / SGLang / TensorRT-LLM](#/inference-engines/three-engines-architecture) 承载线上高并发推理 |

---

## 2. 为什么纯 SFT 训不出真正的 Agent？（SFT vs RLVR）

很多团队做垂直 Agent 微调时，习惯收集几万条成功轨迹直接跑 SFT，结果上线一跑就“照本宣科、一碰异常就懵”。根源在于监督学习与强化学习在**误差恢复分布**上的本质差异：

- **SFT 是离线静态模仿**：训练时每一步都喂标准示范上下文，模型从没见过“自己改错代码导致编译报错 50 行后该如何回滚排查”；一旦上线偏离示范轨迹一步，就会陷入级联错误（Compounding Errors）；
- **RLVR（Reinforcement Learning with Verifiable Rewards）是在线闭环试错**：模型自己采样出 8–16 条完整多轮轨迹，每条都在真实环境里跑完验证——**走通的那条被拉高概率，死循环或瞎编结论的那条被压低概率**，模型由此把“先查证再修改、报错就读堆栈、确认通过再结束”真正刻进参数权重里。

> [!IMPORTANT] 解开已有专题里的三大“后训练归因”
> 1. **为什么系统提示词体量差出近 30 倍？** 在 [四大 Agent 系统提示词源码横评](#/system-prompts/four-agents-comparison) 与 [工业级提示词法则 2](#/system-prompts/engineering-principles) 中，OpenCode 给 Claude 只写 ~300B，给 Kimi/通用模型却要写 8.8KB——因为强 RL 后训练模型已把行动偏置与纠错纪律内化进权重，外挂啰嗦说教反而稀释注意力；
> 2. **为什么 Codex 偏爱 Freeform `apply_patch` 而非 JSON `edit`？** 见 [内置工具源码对比](#/system-prompts/builtin-tools)——通过 **Harness-Model 联合训练（Co-Design）**，在 RL Rollout 阶段直接把真实工具语法、[`WorldState` 增量快照](#/codex/core/compaction) 与压缩边界放进训练闭环，实现“所训即所用”；
> 3. **端到端 GUI 模型如何摆脱脆弱 DOM？** 见 [Set-of-Mark 视觉定位](#/gui-automation/browser-use/set-of-mark)——UI-TARS、OS-Atlas 等模型正是通过大规模桌面环境 RL，把屏幕像素坐标 Grounding 能力直接训进多模态权重。

---

## 3. 2026 工业级 RL 基础设施的双强核验基线

当后训练从单轮问答走向几十轮工具调用的 **Agentic RL**，核心瓶颈不再只是算法公式，而是极其复杂的**分布式训推协同系统工程**。本专题后续三篇均基于 2026-11 一线开源 RL 基础设施的源码实证核验：

| 框架 | 源码核验基线 | 2026 架构路线与核心特征 | 代表定位 |
|---|---|---|---|
| **`verl`** | `volcengine/verl @ 9bdd3713`（`2026-11-24`） | **已完成 v1 重构**：退役旧版 `RayPPOTrainer` 与 `sharding_manager/`；统一训练后端抽象 `BaseEngine`（FSDP2 / Megatron / VeOmni / TorchTitan）+ 独立热同步层 `verl/checkpoint_engine/`（NCCL / NIXL / Mooncake / 稀疏 `delta_sharded`）+ `TransferQueue` 异步轨迹总线 + 状态机 `ToolAgentLoop` | **全生态通用模块化 RL 底座**：同时覆盖多种训练与推理后端，支持同步共置、异步共置与分离切卡三种模式 |
| **`slime`** | `THUDM/slime @ 79aa41a8`（`2026-11-06`） | **Megatron-LM + SGLang 垂直极致协同**：原生四模式权重热更新（CUDA IPC / 每 PP 组 NCCL / 磁盘 / 磁盘稀疏 Delta）、R3 MoE 路由回放、OPSM 负优势熔断、**协议代理式 TITO 引擎**（支持直接把 headless `ClaudeCodeHarness` / `CodexHarness` 放进 `E2BSandbox` 采轨迹） | **面向超大规模 MoE 与真实 Coding Agent 联合训练的垂直高性能栈** |

> [!NOTE] 本专题阅读导览
> - 搞懂 **GRPO / DAPO 算法闭环、训推不一致暗礁与 MoE R3 路由回放** → 下一篇 [02 · RLVR、GRPO/DAPO 与训推偏差稳定化](#/agent-post-training/rl-algorithms-and-stability)；
> - 搞懂 **同卡共置 vs 训推分离、两阶段唤醒防 OOM 与毫秒级稀疏权重热同步** → [03 · 训推混合集群与毫秒级权重热同步](#/agent-post-training/hybrid-engine-and-weight-sync)；
> - 搞懂 **多轮 Agentic Rollout 两大流派、长尾拖尾治理、E2B 沙箱保活与防作弊** → [04 · 多轮 Agentic Rollout、长尾治理与沙箱并发](#/agent-post-training/agentic-rollout-and-sandbox)。
