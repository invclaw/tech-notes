> [!NOTE] 本页聚焦
> 深入拆解 Windows 进程级沙箱的底层内核机制：Windows 没有 Unix 式的 Namespace，它是如何依靠 **Restricted Token（受限令牌）**、**AppContainer（默认全拒绝）** 和 **Job Object（进程树与资源收口）** 实现等效甚至更细粒度隔离的？

## 1. Windows 安全模型底座：Access Token + ACL + SRM

要理解 Windows 沙箱，先抓住它最核心的访问控制模型：
- 每个进程都背着一张由内核颁发的**安全令牌（Access Token）**，里面写着：我是谁（用户 SID）、我属于哪些组（组 SIDs）、我有哪些系统特权（Privileges）、以及我的**完整性级别（Integrity Level，从 Untrusted / Low / Medium / High 到 System）**。
- 每个文件、目录、注册表键、命名管道上都挂着一张**访问控制列表（DACL）**，写着“允许或拒绝哪些 SID 做什么操作”。
- 每次进程试图打开任何资源，内核的**安全引用监视器（SRM，Security Reference Monitor）**就会拿“令牌”去核对“DACL”。

Windows 进程级沙箱的本质，就是**给子进程发一张“极度缩水的特制令牌”，让内核 SRM 自动把一切未授权访问挡在门外**。

---

## 2. 第一层：Restricted Token（受限令牌）

早期和轻量场景常用 `CreateRestrictedToken` 基于当前用户令牌做“减法”：
1. **剥离高危特权**：清空 `SeDebugPrivilege`、`SeBackupPrivilege` 等所有管理员级特权；
2. **管理员组 SID 降格为 Deny-Only**：把 `Administrators` 组标记为“只参与拒绝规则匹配，不再赋予任何允许权限”；
3. **叠加 Restricting SIDs（双重访问检查）**：内核 SRM 在检查对象权限时，必须做**两轮独立校验**——普通 SID 列表要通过，**且** Restricting SIDs 列表也要通过，才能放行；
4. **调低完整性级别（Mandatory Integrity Control）**：把令牌降为 **Low Integrity**。Windows 内核强制规定“低完整性进程默认不能写入中/高完整性对象”（即著名的 *No-Write-Up* 原则），保护用户桌面、系统目录和普通应用进程不被篡改。

> [!WARNING] Restricted Token 的局限
> 如果某个目录的 ACL 里写着 `Everyone: Allow Read` 或 `Authenticated Users: Allow Read`，仅靠 Restricted Token 有时仍可能读到一些公共可读路径。因此现代强隔离方案普遍升级到了 **AppContainer**。

---

## 3. 第二层：AppContainer（现代“默认全拒绝”强隔离）

Chromium/Edge 渲染进程、UWP 应用以及 Codex 的现代 Windows 沙箱都基于 **AppContainer**（Windows 8+ 原生内核特性），它从“做减法”彻底转向了**“默认全拒绝 + 显式白名单授权”**：

1. **专属 Package SID（天然隔离宿主机）**：
   - 系统为沙箱分配一个全局唯一的 **AppContainer Package SID**，同时将进程完整性设为 Low；
   - 宿主机上用户的 `Documents`、`Desktop`、`~/.ssh` 等目录的 ACL 里**压根没有这个 Package SID**——因此内核 SRM 天然拒绝该进程读写宿主机几乎所有个人文件！
   - 只有父进程显式把该 Package SID 的读写 ACE（访问控制项）加到**目标项目工作区目录**的 ACL 上，沙箱内的命令才能访问工作区。
2. **网络能力显式授权（Capabilities）**：
   - AppContainer 令牌里如果不显式授予 `internetClient` / `privateNetworkClientServer` 能力 SID，进程在内核网络层就会直接被禁止建立外连或局域网连接——无需额外配置防火墙规则即可一键断网。
3. **跨进程与对象命名空间隔离**：
   - AppContainer 进程拥有**独立的内核对象命名空间**（Named Pipes / Mutex / Shared Memory 等无法直接触碰宿主机全局对象）；
   - 叠加 **UIPI（用户界面特权隔离）**，低完整性进程无法向中/高完整性的桌面窗口（如用户的终端、浏览器、IDE）发送键盘/鼠标消息或做 DLL 注入。

---

## 4. 第三层：Job Object（资源限额与一键清理进程树）

令牌解决了“能访问什么”，而 **Job Object** 解决的是“能消耗多少资源、以及取消任务时怎么杀干净”——它在角色上等价于 Linux 的 `cgroups + PID 清理`：
- **资源硬封顶**：可限制沙箱内最大活跃进程数（防 Fork 炸弹）、CPU 速率上限、以及单进程/全 Job 内存提交上限；
- **防逃逸出 Job**：禁止子进程通过 `CREATE_BREAKAWAY_FROM_JOB` 脱离管控；
- **关闭即全灭（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）**：只要 Agent 取消任务或父进程异常退出导致 Job 句柄关闭，Windows 内核会**原子级终止该 Job 下的全部子孙进程**，彻底杜绝残留僵尸后台进程。

---

## 5. 最小实践单元与 Agent 交互方式

Windows 没有类似 `bwrap` 的单行 CLI，Agent 运行时（如 Codex Windows 沙箱）通过 Win32 API 按固定四步拉起一个最小受控子进程，并通过匿名管道（Anonymous Pipes）或 ConPTY 交互：

```text
1. CreateAppContainerProfile(...)       → 申请唯一 Package SID（默认全拒绝宿主机文件与网络）
2. SetNamedSecurityInfo(workdir, SID)   → 仅给目标项目工作区目录 ACL 加上该 Package SID 的读写权限
3. CreateJobObject + KILL_ON_JOB_CLOSE  → 创建资源限额与“关闭即全灭”作业对象
4. CreateProcessW(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES)
   + AssignProcessToJobObject           → 挂起创建进程、绑入 Job 后恢复运行，经 ConPTY/管道收发输出
```

- **交互结果**：子进程默认无法读取 `Documents`、`~/.ssh` 等个人目录，未授 `internetClient` 能力时无法联网；任务取消时父进程关闭 Job 句柄，内核瞬间清理整棵子孙进程树。
