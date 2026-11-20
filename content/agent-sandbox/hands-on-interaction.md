> [!FOCUS] 本页目标
> 把抽象原理落地成最直观的感性认知：**怎么用一条命令 / 几行代码以“最小单元”开启一个沙箱？以及 AI Agent 在运行时到底是怎么和沙箱对话、拿结果、做清理的？**

## 1. Agent 和沙箱之间到底是怎么交互的？

不管底层是本机进程、Docker 容器还是远在云端的 E2B MicroVM，对大模型来说它看到的永远是同一套抽象工具（如 `exec`、`read`、`write`、`run_code`）。真正的差异藏在 **Agent 运行时（控制面）到沙箱之间的物理通信通道**：

![Agent 与四类沙箱的底层交互链路对比](./assets/agent-sandbox-interaction.svg)

### 一次完整的「Agent ↔ 沙箱」回合是怎么跑通的？
1. **模型发出意图**：大模型输出结构化工具调用（例如：`exec("pytest tests/")`），此时模型并没有直接执行任何东西；
2. **控制面路由与策略把关**：Agent 运行时检查工具白名单、校验路径是否越界、决定路由到哪个沙箱实例（首次使用则懒创建并绑定当前会话 ID）；
3. **跨边界投递执行**：
   - **进程级**：控制面 `spawn` 启动 `sandbox-exec` / `bwrap` 包裹目标命令，直接通过操作系统的 `stdin`/`stdout`/`stderr` 管道实时读取输出；
   - **本地容器**：控制面先起一个长驻休眠容器（`sleep infinity`），每轮用 `docker exec` 把命令注入同一个容器；文件读写则通过宿主机挂载映射与路径校验桥接完成；
   - **远端主机**：通过复用的 SSH 长连接把命令和文件流送往远端机；
   - **云端 MicroVM（如 E2B）**：控制面调用 HTTPS/gRPC API，请求经云端网关转发给运行在 MicroVM 内部的轻量守护进程（`envd`），由 `envd` 在隔离内核里执行并流式回传结果；
4. **回传与收口**：控制面把 `stdout` / `stderr` / `exitCode` 做体积截断与脱敏，包装成 `tool_result` 喂回给大模型继续下一轮推理；任务取消或空闲超时时，由控制面统一杀进程树、休眠或销毁沙箱。

---

## 2. 最小单元实战：四种沙箱怎么“最小化”启动？

下面四个例子都刻意压到**最精简的可运行形态**，方便你一眼看懂每类沙箱的最小边界。

### 2.1 macOS Seatbelt（1 条命令起进程级沙箱）
目标：允许读取系统库和当前目录，**只允许写当前目录和 `/tmp`，彻底禁止联网**。

```bash
sandbox-exec -p '
(version 1)
(deny default)
(allow process-exec process-fork)
(allow file-read*)
(allow file-write* (subpath "/private/tmp") (subpath "'"$(pwd)"'"))
' /bin/bash -c 'echo "ok" > ./demo.txt && curl -I https://example.com'
```
- **现象**：写当前目录 `demo.txt` 成功；`curl` 立刻被内核拦截失败（因为没写 `(allow network*)`）；改写 `~/.ssh` 或桌面文件也会直接报 `Operation not permitted`。

---

### 2.2 Linux Bubblewrap（1 条命令起无 root 命名空间沙箱）
目标：无需 root，把系统目录只读挂入、只暴露当前项目目录、**隐藏宿主机家目录并彻底断网**。

```bash
bwrap \
  --ro-bind /usr /usr \
  --ro-bind /lib /lib \
  --ro-bind /bin /bin \
  --bind "$(pwd)" /workspace \
  --tmpfs /tmp \
  --proc /proc --dev /dev \
  --unshare-all \
  --chdir /workspace \
  /bin/sh -c 'ls -la / && ls -la /workspace'
```
- **现象**：沙箱里看到的根目录只有你显式挂进去的 `/usr`、`/workspace`、`/tmp`，宿主机上的 `~/.ssh` 和其他进程完全不可见；`--unshare-all` 同时断开网络与 PID 命名空间。

---

### 2.3 Docker（1 条命令起最小权限加固容器）
目标：模拟 OpenClaw 默认容器沙箱的最小加固形态——**断网 + 只读根 + 限容内存盘 + 丢弃全部内核能力 + 禁止提权**。

```bash
# 1. 起一个长驻隔离容器（当前目录只读挂载到 /workspace）
docker run -d --name agent-box \
  --network none \
  --read-only \
  --tmpfs /tmp:size=256m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  -v "$(pwd)":/workspace:ro \
  debian:bookworm-slim sleep infinity

# 2. Agent 每轮工具调用通过 exec 注入执行
docker exec -w /workspace agent-box ls -la

# 3. 任务结束后销毁
docker rm -f agent-box
```
- **现象**：容器常驻免去每条命令反复建容器的开销；内部无网络、改不了系统文件、也改不了只读挂载的 `/workspace`。

---

### 2.4 E2B（几行 SDK 起云端 Firecracker MicroVM）
目标：本机零容器依赖，直接从云端快照百毫秒拉起一台独立内核 MicroVM，执行命令、写文件、最后销毁。

```ts
import { Sandbox } from "e2b";

// 1. 从预热快照创建独立内核 MicroVM（默认带 TTL 超时保护）
const sbx = await Sandbox.create({ timeoutMs: 300_000 });

// 2. 通过内置 envd 守护进程读写文件与执行命令
await sbx.files.write("/workspace/hello.py", "print(6 * 7)");
const res = await sbx.commands.run("python3 /workspace/hello.py");
console.log(res.stdout); // "42"

// 3. 任务结束立即销毁释放资源
await sbx.kill();
```
- **现象**：整个过程不消耗本机 CPU、不碰本机文件系统、无需装 Docker；`sbx.commands.run` 和 `sbx.files.write` 底层都是向 MicroVM 里的 `envd` 发 HTTPS/gRPC 请求，结果直接返回给 Agent Loop。
