> [!FOCUS] 强隔离派的核心诉求
> 如果你要做一个**面向公网的多租户 Agent 平台**，或者用户本机不想装 Docker，却要放手让 Agent 执行任意安装、编译、爬虫和不可信脚本——**硬件虚拟化级别的轻量虚拟机（MicroVM）与 E2B 这类云端沙箱平台**就是终极防线。

## 1. E2B 这种云端沙箱，和前面讲的沙箱到底有什么本质区别？

很多人把 E2B 理解成“跑在云上的 Docker”，这其实是误解。E2B 与前面讲的 Seatbelt / `bwrap` / Docker 有**两层本质区别**：

### 区别一：隔离底座不同（独立内核 vs 共享内核）
- **Seatbelt / `bwrap`（进程级）**：共享宿主机用户态 + 共享宿主机内核，只是给单条子进程套权限罩；
- **Docker / Podman（容器级）**：独立用户态，但**依然共享宿主机 Linux 内核**；
- **E2B（Firecracker MicroVM）**：底层使用 KVM 硬件虚拟化，**每个沙箱是一台拥有完全独立 Linux 内核的轻量虚拟机**。哪怕模型在里面拿到 root 权限、改内核参数、甚至把 Guest OS 玩崩，都完全影响不到宿主机和其他用户的沙箱。

### 区别二：“隔离原语” vs “全托管沙箱平台（Sandbox-as-a-Service）”
- `bwrap`、Seatbelt、Docker 只是**底层隔离原语**——你需要自己管镜像制作、进程通信、文件读写接口、超时清理、并发限流和多租户隔离；
- **E2B** 把整套东西封装成了面向 AI Agent 的**托管平台**：
  1. **云端控制面（Control Plane）**：负责模板镜像构建、预热快照池管理、按秒计费、自动休眠与过期销毁；
  2. **Firecracker MicroVM**：通过剥离传统 BIOS/USB/老旧 PCI 模拟 + **内存快照恢复（Snapshot Restore）**，跳过完整开机流程，把传统虚拟机几十秒的启动压到 **150ms～500ms**；
  3. **VM 内部轻量守护进程（`envd`）**：每台 E2B MicroVM 里都内置了一个极小的守护进程，通过 HTTPS/gRPC 直接对外暴露 **执行命令、流式 PTY、读写文件、有状态代码解释器（Jupyter 内核）、公网端口预览 URL** 五大标准能力——Agent 无需自己折腾 SSH 或挂载卷。

| 对比维度 | 本地进程级（Codex / Claude Code） | 本地容器级（OpenClaw Docker） | 云端 MicroVM 平台（E2B / Daytona） |
|---|---|---|---|
| **角色定位** | 本地隔离原语 | 本地隔离原语 | 全托管沙箱平台（SaaS） |
| **是否独立内核** | 否（共享内核+用户态） | 否（共享内核，独立用户态） | **是（独立 Guest Linux 内核）** |
| **启动方式** | 直接 `spawn`（几毫秒） | 拉起容器（百毫秒～1 秒） | 内存快照恢复（~150–500ms + 网络往返） |
| **本机文件交互** | 直接读写本机目录 | Bind Mount 宿主机目录 | 需通过 API 上传/下载或 Git 同步 |
| **多租户安全性** | 不适合多租户 | 半信任团队可用 | **公网多租户不可信代码首选** |
| **运维与成本** | 零成本，但受宿主机 OS 限制 | 需本机装 Docker，免费 | 按秒付费，零本地运维 |

---

## 2. 云端托管沙箱的三大工程难题

把沙箱搬到云端（E2B、Daytona、OpenClaw 的 Crabbox / OpenShell）后，隔离问题解决了，但会引入三个新的架构取舍：

1. **工作区谁是真源？（本地 vs 云端同步）**
   - **Mirror 双向同步**（如 OpenShell `mirror`）：本地保持真源，每次执行前把改动推上云、执行完再拉回本地；体验最像本机，但有同步延迟与并发写冲突风险；
   - **Remote 远端真源**（如 E2B / Crabbox / SSH）：首次上传代码树或直接 `git clone` 进云端，后续全部在云端操作，最后只把结果或 PR 推回，吞吐高、延迟低。
2. **租约与成本防失控**：
   - 预留**固定租约 ID**（防网络抖动重试时重复开出多台僵尸云机器）；
   - 同时设定 **总生存期（TTL）** 与 **空闲休眠超时（Idle Timeout）**，先到者生效；凭据只留在控制面，不自动灌进云机器环境变量。
3. **跨网交互体验**：
   - 命令流式输出、PTY 交互终端与 Web 端口预览全部经云端网关隧道转发，需要做好断线重连与输出截断。

---

## 3. 实战选型决策指南

| 你的业务场景 | 推荐沙箱层级 | 典型选型 | 核心理由 |
|---|---|---|---|
| **单人本机 Coding Assistant** | **L2 · OS 进程级** | macOS Seatbelt / Linux `bwrap` + Landlock | 毫秒级启动、零镜像维护、无缝复用本机编译器和依赖 |
| **个人 / 小团队 7×24 多渠道 AI 控制面** | **L3 · 标准容器级** | Docker / Podman + 断网/只读根/剥离能力 | 跨平台一致、可隔离群聊与访客、支持独立沙箱浏览器、零云费用 |
| **本机不想装 Docker，但控制面留本地** | **L5 · 云端租约机** | Crabbox（Daytona）/ OpenShell 远端 | 控制面与凭据留本机，不可信执行全甩给用完即弃的云机器 |
| **公网多租户 Agent SaaS 平台** | **L4 强化容器 / L5 MicroVM** | **E2B** / Firecracker / Modal / Kata | 面对完全不可信的陌生用户代码，必须守住独立内核硬隔离底线 |
| **纯脚本 / 数据处理 / 插件扩展** | **L1 · 语言运行时** | WASM / QuickJS / V8 Isolate | 微秒级启动、极低内存、能力白名单精确可控 |

---

## 4. 最小实践单元与 Agent 交互方式（以 E2B 为例）

云端 MicroVM 沙箱不需要本机装 Docker，也不靠本地管道交互：Agent 运行时通过 SDK 向云端网关发 HTTPS/gRPC 请求，由运行在 MicroVM 内部的轻量守护进程（**`envd`**）完成文件写入、命令流式执行与状态保持：

```ts
import { Sandbox } from "e2b";

// 1. 从预热快照创建独立内核 MicroVM（自带 TTL 超时防僵尸机）
const sbx = await Sandbox.create({ timeoutMs: 300_000 });

// 2. 通过 VM 内置 envd 守护进程读写文件与执行命令
await sbx.files.write("/workspace/hello.py", "print(6 * 7)");
const res = await sbx.commands.run("python3 /workspace/hello.py");
console.log(res.stdout); // "42"

// 3. 任务结束后立即销毁释放计费资源
await sbx.kill();
```

- **交互特点**：整个过程不碰本机文件系统、不消耗本机 CPU；结果经 HTTPS/gRPC 流式回传给 Agent Loop，若沙箱内启动了 Web 服务，还可通过 `sbx.getHost(port)` 直接拿到云端公网预览地址。
