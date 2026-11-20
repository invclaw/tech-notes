> [!FOCUS] 轻量派的核心诉求
> 开发者在自己电脑上用 Coding Agent（如 Codex、Claude Code）时，最怕“跑一句测试还要拉镜像、配挂卷”。**OS 原生进程级沙箱**和**语言运行时沙箱**的核心目标就是：**零镜像依赖、毫秒级启动、直接复用本机全套工具链**。

![三大操作系统进程级沙箱内核拦截链路对比](./assets/os-sandbox-internals.svg)

## 1. 三大操作系统进程级沙箱对比

三大操作系统实现进程级沙箱的哲学截然不同：

| 操作系统 | 核心隔离原语 | 内核拦截模型 | 一句话本质 |
|---|---|---|---|
| **macOS** | **Seatbelt**（`sandbox-exec` + XNU MAC） | 策略编译为内核字节码，挂在进程 `ucred` 上，由 VFS/Socket/Mach 钩子统一裁决 | **声明式统一钩子**（一套规则管文件 + 网络 + IPC） |
| **Linux** | **Bubblewrap (`bwrap`) + Landlock + Seccomp** | 三套正交内核原语串联：Namespace 改视野、Landlock 锁目录树、Seccomp 滤系统调用 | **正交原语拼装**（各管一层，层层叠加） |
| **Windows** | **Restricted Token / AppContainer + Job Object** | 降权安全令牌 + 唯一 Package SID 驱动内核安全引用监视器（SRM）做 ACL 判定 | **身份令牌 + ACL 门禁**（默认全拒绝，按需给对象开门） |

---

## 2. 语言 / 运行时级沙箱（WASM · QuickJS · V8 Isolate）

如果 Agent 要执行的不是任意 Shell 命令，而是**一小段计算脚本、数据转换或插件逻辑（如 Code Mode）**，连操作系统子进程都可以省掉：

- **WebAssembly（WASM / WASI）**：代码编译为字节码跑在确定性线性内存里，默认没有任何文件、网络或时钟能力；宿主按“能力模型（Capability-based）”逐项显式授予权限，天然跨平台且杜绝内存越界逃逸。
- **V8 Isolate / QuickJS**：在同一进程内开辟极轻量的独立 JS 虚拟机，冷启动微秒～几毫秒、内存仅几 MB，适合内嵌在 Agent 循环里跑轻量代码。
- **局限**：无法运行通用 Linux CLI、编译器（`gcc` / `cargo`）和系统工具，因此常作为通用 Shell 沙箱的补充。

> [!TIP] 深入阅读本节三个子页面
> 点击下方卡片或左侧子目录，逐一拆解 **macOS（2.1）**、**Linux（2.2）** 与 **Windows（2.3）** 进程级沙箱的底层内核原理与实战踩坑点。
