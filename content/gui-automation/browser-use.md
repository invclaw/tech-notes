> [!FOCUS] 核心问题
> 一个现代网页的原始 HTML 动辄几十万字符，塞满无意义的 `<div>` 和 CSS 类名，直接喂给大模型既爆窗口又找不准按钮。**现代 Browser Use 的精髓，在于把杂乱网页压缩成极简的「语义交互树（AXTree）+ 短编号」**。

---

## 1. 底层通道：CDP 与 Playwright

几乎所有主流 Browser Use 框架（Playwright MCP、Browser-Use、OpenClaw 沙箱浏览器）底层都建立在 **CDP（Chrome DevTools Protocol）** 或封装了 CDP 的 **Playwright** 之上：
- 通过 WebSocket 直接控制真实 Chromium 进程，能精确拿到 DOM、无障碍树、网络请求、Console 日志与截图；
- 自动处理“等待元素可见、滚入视口、等待动画稳定、触发真实浏览器事件”，比拼凑模拟点击稳定得多。

---

## 2. 感知与定位：AXTree 快照 + Set-of-Mark（SoM）

### 2.1 主流方案：Accessibility Tree（无障碍树）+ 短编号
浏览器为了给视障读屏软件提供语义，原生就维护了一棵极其干净的 **Accessibility Tree**——天然过滤掉装饰性 `<div>`，只保留按钮、输入框、链接、复选框及其可见文本。

Agent 运行时在执行前抓取一帧 AXTree 快照，给每个可交互节点编上极短的 `ref` 编号发给模型：

```yaml
# 喂给模型的网页快照（仅几百字，替代几十万字原始 HTML）
- document "登录 - 示例后台" (url: https://admin.example.com/login)
  - textbox "邮箱地址" [ref=e4]
  - textbox "密码" [ref=e7] (type=password)
  - checkbox "记住登录" [ref=e9] (checked=false)
  - button "立即登录" [ref=e12]
```

模型只需返回极简结构化动作，**完全不需要写脆弱的 CSS/XPath 选择器，也不需要猜像素坐标**：

```json
{ "tool": "browser_fill",  "args": { "ref": "e4", "value": "alice@example.com" } }
{ "tool": "browser_click", "args": { "ref": "e12" } }
```

### 2.2 补充方案：Set-of-Mark（SoM 视觉标注）
当遇到自定义 `<canvas>`、图表、或无障碍属性缺失的奇葩网页时，运行时会在截图上把每个可点击区域画上带编号的彩色高亮框，把**标注后的截图 + 编号表**一起交给多模态模型，兼顾视觉理解与精准点击。

### 2.3 动手试一试：3 种方式手动获取真实 AXTree

1. **零代码（Chrome F12 直接看）**：
   - 打开任意网页按 `F12` → 切到 **Elements** 面板 → 右侧子标签选 **Accessibility** → 勾选 **`Enable full-page accessibility tree`**（右上角会出现一个小人图标，点击即可把整个 DOM 树一键切换成完整的无障碍树视图）。
2. **用 Playwright 一行拿 YAML 格式快照（最贴近 AI Agent 看到的样子）**：
   ```js
   import { chromium } from "playwright";

   const browser = await chromium.launch();
   const page = await browser.newPage();
   await page.goto("https://example.com");

   // 直接输出整页精简 YAML 无障碍树
   const snapshot = await page.locator("body").ariaSnapshot();
   console.log(snapshot);
   await browser.close();
   ```
3. **直连原生 CDP 调 `Accessibility.getFullAXTree`（看浏览器内核原始结构）**：
   ```js
   // 同样可在 Playwright 里直接拿到底层 CDP Session
   const cdp = await page.context().newCDPSession(page);
   const { nodes } = await cdp.send("Accessibility.getFullAXTree");
   console.log(nodes.slice(0, 5)); // 每个节点含 role / name / backendDOMNodeId / childIds
   ```
   > 若不用 Playwright，也可先用 `chrome --remote-debugging-port=9222` 启动浏览器，访问 `http://127.0.0.1:9222/json` 拿到目标 Tab 的 `webSocketDebuggerUrl`，连上 WebSocket 后发送 `{"id":1,"method":"Accessibility.getFullAXTree"}` 即可拿到一模一样的 JSON。

---

## 3. Browser Use 的四大实战难点

1. **Shadow DOM 与跨域 `iframe`**：很多登录框和支付控件嵌在多层 `iframe` 或 Shadow DOM 里，快照器必须递归穿透所有 frame 并维持全局唯一 `ref`；
2. **动态 SPA 状态同步**：点击按钮后页面往往异步发 XHR 局部刷新，执行器需要结合网络空闲/DOM 变化短等待后再抓下一帧快照；
3. **登录态与 Cookie 隔离**：绝对不要直接复用用户本机主力浏览器的默认 Profile，应为 Agent 分配独立的用户数据目录（持久化必要登录态，同时隔离个人密码库）；
4. **反爬与验证码边界**：Cloudflare Turnstile / 滑块验证码不是靠模型硬点就能稳定解决的，生产方案应结合“实时画面人工接管（HITL）”。
