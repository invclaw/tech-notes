> [!FOCUS] 为什么 GUI 自动化是 Agent 基建的关键拼图？
> 现实世界里，大量企业后台、SaaS 系统、桌面客户端与遗留软件根本没有开放 API，也无法靠 Shell 命令操作。**Browser Use** 与 **Computer Use** 让 Agent 长出了“眼睛和手”，把所有只给人类设计的图形界面都变成了可编排的工具。

![Browser Use 与 Computer Use 架构与闭环对比](./assets/browser-computer-use-arch.svg)

## 核心维度横评：Browser Use vs Computer Use

两者本质都在跑同一个闭环：**感知（Perception）→ 定位（Grounding）→ 动作（Action）→ 校验（Verification）**，但在抽象层级、成本与稳定性上差异巨大：

| 对比维度 | Browser Use（浏览器级） | Computer Use（全桌面级） |
|---|---|---|
| **作用范围** | 仅限浏览器内的网页（Web App / SaaS） | 整个操作系统桌面（任意原生软件、弹窗、跨应用切换） |
| **主要感知输入** | **Accessibility Tree（无障碍树）** + 可选标注截图 | **整屏像素截图**（可选叠加 OS 辅助功能树） |
| **元素定位方式** | 语义引用编号（如 `ref="e12"`）或选择器 | 绝对像素坐标（如 `x=640, y=420`） |
| **底层控制通道** | CDP（Chrome DevTools Protocol）/ Playwright | OS 键鼠注入（Linux `xdotool`/`uinput`、macOS `CGEvent`、Win `SendInput`） |
| **Token 成本与速度** | **低成本、快**（文本树仅几千字，一次定位即中） | **成本高、较慢**（每步都要传高清图，常需多轮微调坐标） |
| **抗干扰稳定性** | 高（自动等待元素可点击，不受分辨率缩放影响） | 较脆弱（易受窗口遮挡、DPI 缩放、弹窗打断影响） |
| **典型隔离形态** | 独立 Headless/容器浏览器（如 [OpenClaw 沙箱浏览器](#/openclaw/security/sandbox-backends)） | 独立虚拟桌面容器 / 云桌面（`Xvfb` + `noVNC`/WebRTC，见 [沙箱技术全景](#/agent-sandbox/overview)） |

> [!TIP] 工程选型黄金法则（能轻则轻）
> **优先直接调 API / CLI → 没有 API 再用 Browser Use（AXTree 优先）→ 只有必须跨出浏览器操作桌面软件或 Canvas 画面时，才升级到纯视觉 Computer Use。**
