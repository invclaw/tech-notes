> [!FOCUS] 为什么 AI Agent 必须有沙箱？
> 传统软件的代码是人写好并审计过的；而 AI Agent 的核心能力是**“读取外部不可信输入（网页、邮件、群聊、第三方仓库），然后自主生成并执行命令与代码”**。仅靠提示词约束模型绝不可靠，必须用操作系统或虚拟化层的**沙箱（Sandbox）**画死物理破坏半径。

![AI Agent 沙箱五级隔离谱系](./assets/sandbox-spectrum.svg)

## 五级沙箱全景对比

业界不存在“唯一最好”的沙箱，所有方案本质上都是在**隔离强度、启动速度、本机工具链复用度、运维成本**四个维度之间做权衡：

| 隔离层级 | 代表技术 | 是否共享宿主机内核 | 启动耗时 | 能否跑任意 Linux 命令 | 典型产品 / 场景 |
|---|---|---|---|---|---|
| **L1 · 语言/运行时级** | WASM、QuickJS、V8 Isolate、Pyodide | 共享（甚至共享进程） | 微秒～几毫秒 | 不能（仅限该语言/沙箱 API） | 插件脚本、纯计算代码解释器、Code Mode |
| **L2 · OS 进程级** | macOS Seatbelt、Linux `bwrap` + Landlock / Seccomp | 共享内核与用户态 | 几毫秒～几十毫秒 | 能（直接复用本机全部工具链） | **OpenAI Codex**、**Claude Code**（单人本机写代码） |
| **L3 · 标准容器级** | Docker、Podman（Namespace + cgroups） | 共享宿主机内核，独立用户态 | 百毫秒～1 秒 | 能（依赖容器镜像内工具） | **OpenClaw 默认沙箱**、多渠道个人/团队控制面 |
| **L4 · 强化容器级** | gVisor（用户态内核）、Kata Containers | gVisor 拦截系统调用；Kata 独立内核 | 数百毫秒～2 秒 | 能（gVisor 少数偏门 syscall 不兼容） | K8s 多租户 Agent 集群、半信任代码执行 |
| **L5 · MicroVM / 云端沙箱** | Firecracker、Cloud Hypervisor、Apple Virtualization | **完全独立内核（硬件虚拟化）** | 快照恢复百毫秒；冷启秒级 | 能（完整独立 OS） | **E2B**、**Modal**、**Daytona / Crabbox**（云端多租户 SaaS） |

## 本专题结构导览

- **[02 · 轻量派：进程级与语言级沙箱](#/agent-sandbox/process-and-runtime)**：拆解 Codex / Claude Code 使用的 Seatbelt、`bwrap` + Landlock 原理，以及 WASM / QuickJS 的边界；
- **[03 · 均衡派：标准容器与强化容器](#/agent-sandbox/container-and-gvisor)**：拆解 Docker/Podman 的内核三板斧，以及 gVisor、Kata 怎么进一步堵住“共享内核”风险；
- **[04 · 强隔离派：MicroVM、云端沙箱与选型指南](#/agent-sandbox/microvm-and-cloud)**：拆解 Firecracker 快照秒启、云端工作区同步策略，以及不同业务场景下的沙箱选型决策树。
