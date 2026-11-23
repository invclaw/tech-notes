> [!FOCUS] 一句话看懂 E2B 的核心价值
> **E2B 不是“云上的 Docker”**，而是一套面向 AI Agent 的**开源 Firecracker MicroVM 编排平台**——它把「独立内核硬件隔离 + 150ms 内存快照秒启 + 内置 `envd` 守护进程 + 跨天休眠恢复（Pause/Resume）+ 动态端口预览域名」打包成了一个极其简洁的 SDK。

![E2B 底层全栈架构与快照秒启原理](./assets/e2b-arch.svg)

---

## 1. E2B 的四层完整系统架构

从你调用 `Sandbox.create()` 到沙箱里跑完一行 Python，请求穿越四层组件：

1. **① Client SDK（TypeScript / Python）**：面向 Agent 的极简客户端，封装了生命周期（`create` / `pause` / `connect` / `kill`）、命令流式执行（`commands.run` / `pty`）、文件操作（`files.read` / `write` / `watchDir`）与端口域名获取（`getHost(port)`）。
2. **② Edge Proxy & Control Plane（边缘代理与控制面）**：
   - 负责 API Key 鉴权、并发配额、按秒计费与模板元数据管理；
   - 维护 `sandboxId → 宿主机内部 IP` 路由表，将 `https://<port>-<sandboxId>.e2b.app` 实时反向代理到目标 MicroVM 内部对应端口（你在沙箱里 `npm run dev` 起 3000 端口，外部立刻拿到可访问 HTTPS 预览地址）。
3. **③ Orchestrator（裸金属 KVM 宿主机调度器）**：
   - 运行在支持硬件虚拟化（KVM）的 Linux 宿主机上，负责拉起与销毁 Firecracker 进程、管理本地/远端内存与磁盘快照缓存池、以及强制执行 TTL 与空闲回收。
4. **④ Firecracker MicroVM 内部（独立 Guest Linux + `envd`）**：
   - 每台沙箱拥有**完全独立的 Guest Linux 内核**和隔离网络栈，即使内部拿到 root 权限也无法触碰宿主机或其他租户。

---

## 2. 为什么一台真虚拟机能做到 150–300ms 启动？（Snapshot Restore 原理）

传统虚拟机冷启动要经历 BIOS/UEFI → 引导加载器 → Linux 内核初始化 → systemd 拉起服务，动辄 15–30 秒，完全无法满足 Agent 实时交互。E2B 靠**「模板预热快照 + 按需缺页加载」**彻底绕过了开机流程：

1. **构建期（Template Build）**：
   - 开发者写一份类似 Dockerfile 的模板（预装 Python、Node、Playwright、数据科学库等）；
   - E2B 构建器将镜像转为 **ext4 根磁盘**，并**提前真的开机启动一次**（等内核、网络、内置 `envd` 守护进程和预装服务全部就绪）；
   - 在这个“已完全就绪”的瞬间冻结 VM，拍下三件套快照：**完整 RAM 内存快照文件 + vCPU 寄存器/设备状态 + 只读 ext4 根盘基线**。
2. **运行期（`Sandbox.create()`）**：
   - Orchestrator 不再冷启动 OS，而是直接调用 Firecracker 的 **`LoadSnapshot`**；
   - **关键加速——`userfaultfd`（UFFD 按需缺页加载）**：不需要先把几 GB 内存快照全读进物理内存才启动，而是先建立虚拟映射，MicroVM 跑到哪一页内存才瞬间按需加载哪一页；
   - 磁盘层叠加一个轻量的 **Copy-on-Write（写时复制）差异层**，所有写入只落入本沙箱私有增量盘——**150–300ms 内，一台装好全套环境且 `envd` 正在监听端口的独立内核虚拟机直接复活！**

---

## 3. `envd`：为什么 E2B 不靠 SSH 交互？

如果每台临时沙箱都走 SSH，就需要动态注入/轮换 SSH 密钥、处理首连握手延迟与文件传输协议。E2B 在每台 MicroVM 镜像里预装了一个极轻量的 Go 守护进程 **`envd`**（默认监听 `49983` 端口）：

- **统一 Connect/gRPC + HTTP 协议**：一条强类型通道同时承载命令执行（流式 `stdout`/`stderr` + 真实 PTY 终端）、文件二进制上传下载、实时目录监听（`watchDir`）与环境变量注入；
- **Code Interpreter 扩展模板**：在 `envd` 旁再常驻一个 **Jupyter Kernel**，提供 `runCode()` 有状态执行——同一沙箱内多次执行 Python 代码能**跨轮保留内存变量、DataFrame 和数据库连接**，并自动拦截 Matplotlib/Seaborn 生成的图表以 Base64 PNG 返回给多模态 Agent。

---

## 4. Pause / Resume（休眠与跨天复活）与生命周期治理

E2B 相比普通容器沙箱的另一大杀手锏是**完整状态休眠（Beta/托管能力）**：
- **Pause（冻结休眠）**：调用 `await sbx.pause()` 时，Orchestrator 会把此刻**正在运行的整个 MicroVM 内存页 + 磁盘写时复制增量**拍成新快照持久化到对象存储，立刻释放宿主机 CPU/内存并停止计费；
- **Resume（毫秒复活）**：几小时甚至几天后，用同一个 `sandboxId` 调用 `Sandbox.connect(sandboxId)`，MicroVM 从暂停前的精确状态复活——**不仅磁盘上的代码和依赖全在，连暂停前跑着的后台进程和 Python 内存变量都原封不动！**
- **硬成本防线**：每个沙箱强制绑定 TTL（默认 5 分钟，可动态延长 `setTimeout()`），防止 Agent 异常崩溃后留下永久计费的僵尸云机。
