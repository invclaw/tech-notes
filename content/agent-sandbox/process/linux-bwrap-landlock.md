> [!NOTE] 本页聚焦
> 深入拆解 Linux 进程级沙箱的“三件套组合拳”：**Bubblewrap（`bwrap`）怎么做到无 root 改挂载？Landlock LSM 怎么按 inode 锁死目录？Seccomp-BPF 为什么不能过滤文件路径？**

Linux 没有像 macOS Seatbelt 那样一套规则包打天下的单层机制，而是遵循**正交原语组合**哲学——每一层只干一件事，叠在一起构成严密防线。

---

## 1. 第一层：Bubblewrap（`bwrap`）—— 命名空间拼出“最小视野”

普通进程在 Linux 上是没有权限调用 `mount()` 的。那 `bwrap` 为什么不需要 root 也能给子进程拼出一个隔离文件系统？

### 核心原理：Unprivileged User Namespace + `pivot_root`
1. **用非特权 User Namespace 换取“局部管理员权”**：
   - `bwrap` 调用 `unshare(CLONE_NEWUSER | CLONE_NEWNS | ...)` 创建一个新的 **User Namespace** 和 **Mount Namespace**；
   - 在这个新的 User Namespace 内部，它把自己映射成“虚拟 UID 0（root）”。Linux 内核允许这个虚拟 root **只在自己的 Mount Namespace 里**自由执行挂载操作，但对宿主机真实文件依然严格按外部真实 UID 鉴权，**绝不产生任何真实提权**。
2. **搭积木式重构根文件系统**：
   - 在一块干净的内存 `tmpfs` 上建立全新根目录；
   - 把 `/usr`、`/lib`、`/bin` 等系统目录以 **只读绑定挂载（`MS_BIND | MS_RDONLY`）** 映射进去；
   - 把当前项目工作区按需以只读或读写挂载进去；
   - 宿主机上的 `~/.ssh`、`~/.aws`、`~/.kube` 等敏感目录压根不挂（或用空 `tmpfs` 覆盖遮蔽），进程连“看到它们存在”都做不到；
   - 调用 **`pivot_root()`** 把进程根目录切到新根，并卸载旧根，彻底断开退路。
3. **顺手隔离网络与进程树**：
   - 加上 `CLONE_NEWNET` 就能把子进程放进一个只有 `lo`（或全空）的独立网络命名空间，一键断网；
   - 加上 `CLONE_NEWPID` 让子进程看不见也杀不到宿主机上的其他进程；
   - 最后丢弃虚拟命名空间里的全部 Capabilities，再 `exec` 真正的用户命令。

> [!WARNING] Ubuntu 上的经典实战坑：AppArmor 限制非特权 User Namespace
> Ubuntu 23.10 / 24.04 引入了 `kernel.apparmor_restrict_unprivileged_userns=1`，默认阻止没有专门 AppArmor Profile 的普通程序创建非特权 User Namespace——这会导致 `bwrap` 直接报 `Permission denied` 无法启动（OpenClaw 文档里专门用 `openclaw doctor` 帮用户排查的就是这个问题）。

---

## 2. 第二层：Landlock LSM —— 无特权、不可撤销的路径白名单

有时候环境不允许创建 User Namespace（比如受限容器内嵌套、或被 AppArmor 拦截），或者希望在 `bwrap` 之上再加一道内核级双保险，就要用到 Linux 5.13+ 引入的 **Landlock LSM**。

### 核心原理
1. **必须先锁死提权（`PR_SET_NO_NEW_PRIVS`）**：
   - 调用 Landlock 前，内核强制进程先声明“永不通过 SUID/SGID 二进制获取新权限”，防止恶意程序借助宿主机上的 `sudo`/`su` 绕过沙箱。
2. **三步把目录树权限焊死在内核**：
   - `landlock_create_ruleset()`：声明本规则集要管控哪些行为（读文件、写文件、执行、删目录、TCP 绑定/连接等）；
   - `landlock_add_rule()`：传入目标目录的**真实打开文件描述符（fd）**及允许的权限掩码（例如只允许对工作区目录做写操作）；
   - `landlock_restrict_self()`：将规则集永久挂载到当前线程的内核安全上下文中。
3. **按 inode 生效 + 只能叠加收紧**：
   - Landlock 规则绑定的是内核里的目录 **inode**，而不是易被绕过的字符串路径（防软链/重命名绕过）；
   - 一旦生效**永远无法撤销**，所有 `fork/exec` 子孙自动继承；后续只能继续叠套更严的规则（规则取交集）。

---

## 3. 第三层：Seccomp-BPF —— 内核系统调用入口的“防火墙”

即使文件和网络都锁住了，攻击者仍可能利用偏门或高危的 Linux 系统调用（如 `ptrace` 调试注入、`mount`、`bpf`、`io_uring` 内核漏洞）尝试突破。**Seccomp-BPF** 直接把守在用户态进入内核态的总闸门上：

- **工作机制**：进程通过 `prctl` 向内核注册一段 **cBPF 字节码过滤程序**（同样要求先设 `PR_SET_NO_NEW_PRIVS`）。此后该进程及其所有子孙每发起一次 `syscall`，内核在分发到具体内核函数前先跑一遍 BPF 过滤器，直接决定：放行（`ALLOW`）、返回错误码（`ERRNO(EPERM)`）或当场终止进程（`KILL_PROCESS`）。
- **关键局限（为什么 Seccomp 不能替代 `bwrap` / Landlock）**：
  - Seccomp-BPF **只能检查寄存器里的整数值**（如系统调用号、`socket()` 的地址族参数），**不能安全解引用指针指向的文件路径字符串**——因为多线程程序可以在内核检查完路径后、真正打开文件前的瞬间把内存里的字符串改掉（经典的 **TOCTOU 竞态漏洞**）。
  - 因此在 Linux 沙箱的分工里：**视野与路径隔离交给 `bwrap` + Landlock，系统调用攻击面收敛交给 Seccomp-BPF**，三者严丝合缝。
