> [!FOCUS] 一句话听懂 CDP 和 Playwright
> **CDP（Chrome DevTools Protocol）**就是你平时在 Chrome 里按 `F12` 打开开发者工具时，调试面板控制浏览器内核用的**底层 WebSocket 协议**；而 **Playwright** 是架在 CDP 之上的**高阶编排引擎**，替你处理等待、遮挡、iframe 穿透和多会话隔离等所有脏活。

![CDP 与 Playwright 底层通信原理](./assets/cdp-playwright-arch.svg)

---

## 1. CDP（Chrome DevTools Protocol）到底是什么？

当你在本机或容器里启动 Chromium/Chrome 时加上一个调试参数（`--remote-debugging-port=9222`），浏览器就会开放一个本地 WebSocket 调试口。任何外部程序连上这条 WebSocket，就能以 **JSON-RPC 2.0** 双向通信，获得与 Chrome F12 完全同等的“上帝视角”和内核操控权。

CDP 把浏览器能力按**域（Domain）**划分得非常清晰：
- **`Page`**：跳转网页、截屏、导出 PDF、监听页面加载事件；
- **`DOM` & `Accessibility`**：读取 DOM 树与**完整无障碍树（AXTree）**——这正是 Browser Use 抓取精简网页快照的直接数据来源；
- **`Input`**：向浏览器内核直接注入**原生级**鼠标点击、滚轮和键盘事件（产生的 DOM 事件 `event.isTrusted === true`，比网页里跑 JS `el.click()` 更真实，能触发原生表单与权限弹窗）；
- **`Runtime`**：在页面里执行 JS，并实时收到 `console.log` 和页面 JS 报错；
- **`Network`**：实时监听或拦截每一个 HTTP 请求与响应、读写 Cookie（非常适合做 SSRF 内网访问拦截）；
- **`Target`**：管理多标签页（Tab）、新弹窗与跨域 `iframe`——通过 `sessionId` 字段，在**同一条 WebSocket 连接上并发多路复用**控制几十个页面。

### 直观看看原生 CDP 报文长什么样

```json
// 1. 客户端发指令：让当前 Tab 跳转到登录页
{ "id": 1, "method": "Page.navigate", "params": { "url": "https://admin.example.com/login" } }

// 2. 浏览器主动推送事件：页面加载完成
{ "method": "Page.loadEventFired", "params": { "timestamp": 12345.67 } }

// 3. 客户端发指令：拉取整页无障碍树（给大模型看）
{ "id": 2, "method": "Accessibility.getFullAXTree" }

// 4. 客户端发指令：在坐标 (320, 480) 注入真实鼠标左键点击
{ "id": 3, "method": "Input.dispatchMouseEvent", "params": { "type": "mousePressed", "x": 320, "y": 480, "button": "left", "clickCount": 1 } }
```

---

## 2. 既然有了 CDP，为什么还需要 Playwright？

如果你直接手写原生 CDP 去驱动浏览器，很快会被现实网页折磨崩溃：按钮还没渲染出来、动画还在滑、上面盖了个 Cookie 弹窗、输入框嵌在三层跨域 `iframe` 里、刚拿到节点 ID 页面就局部刷新失效了……

**Playwright** 站在 CDP 之上，把这些工程脏活全部封装成了确定性原语：

1. **自动可操作性检查（Actionability Checks）**：调一次 `click()`，Playwright 自动在内部轮询校验：**元素已挂载 → 可见 → 尺寸位置稳定（动画结束）→ 未被其他元素遮挡 → 未禁用**，全部满足才下发真正的 CDP `Input.dispatchMouseEvent`。
2. **`BrowserContext` 毫秒级轻量隔离**：在**同一个 Chromium 进程**里可以瞬间开出几十个完全隔离的 `BrowserContext`（等价于独立无痕窗口，Cookie / LocalStorage / 缓存彻底隔离），比每个 Agent 会话起一个浏览器进程省 90% 内存。
3. **自动穿透 Shadow DOM 与跨域 `iframe`**：内部自动替你附着每个子 frame 的 CDP `Target` 和 `sessionId`，上层调用者只需要面对统一的操作接口。
4. **受管下载、网络路由与 Trace 录屏**：统一接管文件下载目录、支持按规则拦截/改写请求，还能录制完整操作时间线方便事后排障。

---

## 3. 为什么 AI Agent 几乎都用 CDP + Playwright，而不是老牌 Selenium？

| 对比维度 | 老牌 Selenium（WebDriver HTTP） | 现代 CDP + Playwright（WebSocket） |
|---|---|---|
| **通信方式** | 每步发一次单向 HTTP 请求，经 `chromedriver` 二次中转 | **单条长连 WebSocket 直连浏览器内核**，双向实时推流 |
| **事件感知** | 被动轮询，很难实时感知网络请求、Console 报错与弹窗 | 页面跳转、XHR 完成、JS 报错、新下载全部**毫秒级主动推送** |
| **AI 感知能力** | 原生偏 DOM 选择器，缺少一站式无障碍树与深度网络拦截 | 原生暴露 **`Accessibility.getFullAXTree`**、Network 拦截与多路复用 |
| **稳定性与速度** | 易出现 `StaleElementReference` 报错、需手写大量 `sleep` | 内置自动等待与可操作性检查，天然适配 Agent 高频闭环 |
