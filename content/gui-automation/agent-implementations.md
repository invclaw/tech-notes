> [!FOCUS] 核心结论
> 同样是做 AI Agent，四家对 **Browser Use** 和 **Computer Use** 的架构取舍差异极大：**OpenClaw 选择全栈原生内置（含展示与操作分离）**，**OpenCode 内置了带远端隧道的浏览器插件**，而 **Codex 与 Pi 则刻意保持内核精简，统一交给 MCP / 扩展按需接入**。

## 1. 四大主流 Agent 落地全景对比

| Agent | Browser Use 实现方式 | Computer Use 实现方式 | 最具特色的架构设计 |
|---|---|---|---|
| **[OpenClaw](#/openclaw/overview)** | **原生全栈内置**（`extensions/browser`，CDP + Playwright） | **原生内置**（`computer` 工具 + Node 设备/云桌面节点） | **独立隔离 Profile + 沙箱浏览器容器**；`screen`（仅展示）与 `computer`（真操作）严格拆权；内置 SSRF 防护与多远端 CDP 接入 |
| **[OpenCode](#/opencode/overview)** | **官方内置插件**（`plugin-browser`，暴露 `browser` 工具） | 无内置桌面键鼠引擎（通过 MCP / 插件扩展） | **内置 Proxy + Tunnel 隧道**，让本地浏览器无缝预览并自动化测试远端开发机上的 Dev Server；原生支持 `ref` 定位、`frameID` 与页面跳转失效感知 |
| **[Codex](#/codex/overview)** | 无内置浏览器引擎（统一经 **MCP** 挂载，如 Playwright MCP） | 无内置桌面引擎（经 **MCP** 接入，或在宿主如 OpenClaw 中复用宿主能力） | 把外部 Computer Use / Browser MCP 纳入 **Guardian 上下文审查 + App-Server 审批流（Elicitation）** 统一治理 |
| **[Pi](#/pi/overview)** | 无内置（核心仅留 7 个文件/Shell 基础工具） | 无内置 | 彻底贯彻极简内核哲学：全部交给 **MCP** 或 **TypeScript Extensions** 按需组装 |

---

## 2. 逐家拆解：各自到底是怎么做的？

### 2.1 OpenClaw：全栈原生 + 展示与操作拆权
OpenClaw 是四家中唯一把 Browser Use 与 Computer Use 都做成一等内建能力的框架：
- **Browser Use（隔离优先 + 四种形态通吃）**：
  - 默认拉起独立的 **`openclaw` 浏览器 Profile**（橙色标识），彻底隔离用户的个人主力浏览器；同时提供 `user` Profile 经 **Chrome DevTools MCP** 按需附着已登录 Chrome；
  - 支持四种部署形态：本机托管 Chromium、独立 **Docker 沙箱浏览器容器**（见 [OpenClaw 五大沙箱后端](#/openclaw/security/sandbox-backends)）、通过 Node 节点代理本机浏览器、以及直连云端托管 CDP（Browserless / Browserbase / Notte）；
  - 随插件附带 **`browser-automation` Skill**，把“抓快照 → 锁定 Tab → 遇到过期 `ref` 自动重抓 → 遇登录/验证码交由人工处理”固化为标准操作流，并内置 **SSRF 导航拦截**、受管下载目录、基于 AXTree + Playwright `boundingBox` 的 **SoM 截图标号**（`screenshotWithLabelsViaPlaywright`）与纯文本模型截图视觉辅助（注：四家仓库均未内嵌本地 YOLO / OmniParser 目标检测模型）。
- **Computer Use（`screen` 只管展示，`computer` 只管操作）**：
  - OpenClaw 刻意把“给人类看画面”和“让模型动键鼠”拆成两个工具：**`screen` 工具**只能在 Control UI 侧栏展开或切换浏览器/远端桌面面板，**没有读像素、截屏和点击权限**；
  - 真正的截屏、坐标点击与键盘输入由 **`computer` 工具**通过绑定的设备节点（Node）或远端桌面环境执行，并严格受节点能力声明与工具策略门控。

### 2.2 OpenCode：面向前后端联调的 `plugin-browser`
OpenCode 没有做重型桌面控制，而是围绕“写代码 → 启 Dev Server → 浏览器验证”做了非常精准的 **`plugin-browser`** 插件：
- **核心能力**：统一 `browser` 工具支持多标签页管理（`tabs.list` / `tabs.focus`）、基于 **`ref` 短编号或 CSS 选择器** 的交互、`frameID` 穿透 `iframe`、以及智能元素可见性/URL 等待（当页面跳转导致 `documentChanged` 时自动识别旧 `ref` 失效）；
- **Proxy + Tunnel 远端联调**：配合 OpenCode 的 Client/Server 分离架构（见 [OpenCode 服务端与生态](#/opencode/server-and-ecosystem)），内置代理与隧道状态机，让运行在远端开发机上的 Web 服务能被安全透传给浏览器工具直接访问和截图验收。

### 2.3 Codex 与 Pi：内核克制，能力交给 MCP 与扩展
- **[Codex](#/codex/overview)**：作为专注代码工程的 Rust 引擎，Codex 把浏览器和桌面控制全部交由外部 **MCP Server** 提供，自身专注守住**安全审批与治理边界**——任何外部 Computer Use MCP 调用都会经过 Guardian 自动风险评估和 App-Server 人工确认弹窗（Elicitation）；当 Codex 作为执行引擎被嵌入 OpenClaw 时，则直接消费 OpenClaw 宿主提供的 `browser` / `computer` 工具。
- **[Pi](#/pi/overview)**：内核只保留 `read` / `write` / `edit` / `bash` / `grep` / `find` / `ls` 7 个最小原语；需要 Browser Use 或 Computer Use 时，通过加载 Playwright MCP 或自定义 TypeScript Extension 扩展，不让未使用的重型依赖污染极简底座。
