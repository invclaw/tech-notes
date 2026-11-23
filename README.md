# Tech Notes · 体系化技术知识库

一个零构建（Zero-Build）、纯静态、面向「架构设计原理 + 图文并茂沉淀」的公开技术知识库。

所有知识内容都是普通 **Markdown 文档 + SVG 架构图**，配合轻量前端静态渲染器，开箱支持多项目树形子目录、Mermaid 流程图、大图缩放滚动预览、明暗主题切换与 `⌘K` 全站搜索。

## 仓库结构

```text
.
├── index.html            # 静态单页入口
├── assets/
│   ├── app.css           # 文档阅读样式、树形侧栏、大图弹窗与深色主题
│   ├── app.js            # 静态路由、多级子页面、搜索、TOC 联动、Mermaid 与缩放灯箱
│   └── *.svg             # 定制架构图与原理图解
├── content/
│   ├── manifest.json     # 项目与多级章节索引（新增项目/子页只需维护此文件）
│   ├── home.md           # 首页内容
│   ├── openclaw/         # 专题 1：OpenClaw 架构设计解析
│   └── agent-sandbox/    # 专题 2：AI Agent 沙箱技术全景
└── vendor/               # 自托管前端依赖（marked / highlight.js / mermaid，无外部 CDN 依赖）
```

## 本地预览

无需安装 Node 依赖或编译，任意静态文件服务器即可启动：

```bash
python3 -m http.server 8080
# 打开 http://127.0.0.1:8080/
```

## 当前已沉淀专题

- **OpenClaw 架构设计解析**：项目全景、Agent Loop 三层嵌套循环与 Steer、上下文修剪与压缩、Session 与多 Agent 隔离、分层记忆与 Dreaming、安全模型与五大沙箱后端
- **Codex 架构设计解析**：Rust 四层解耦架构、Thread/Turn/Item 模型与远端压缩 V2 / WorldState、App-Server 与 Exec-Server 双服务边界、三端原生沙箱与 ExecPolicy / Guardian 审批
- **OpenCode 架构设计解析**：Client/Server 分离与 Effect-TS 内核、单 Fiber 门铃模型与崩溃恢复、后台预压与四级渐进降采样、通配符权限引擎与隐藏 Git 快照时光机
- **Pi 架构设计解析**：极简可组装底座、单文件树形 JSONL 会话与分支摘要、追加式非破坏压缩与超长单轮切分、外置微虚机/凭据代换隔离与供应链加固
- **DeepSeek Harness 架构解析**：Cordis「一切皆插件」底座、Capability Seam 三角色拆分、Event-Sourced 多代日志、模块化压缩四件套、三端进程沙箱、PTC 运行时与带外协议扩展
- **AI Agent 沙箱技术全景**：L1–L5 五级隔离谱系、三大操作系统（macOS Seatbelt / Linux bwrap+Landlock+Seccomp / Windows AppContainer+Job）内核原理、容器与 gVisor/Kata、MicroVM / E2B 与各沙箱最小实践单元
- **大模型推理协议解析**：OpenAI Chat Completions、OpenAI Responses API 与 Anthropic Messages API 的真实请求/返回/SSE 报文对照与服务端上下文治理
- **Browser Use 与 Computer Use**：CDP/Playwright + AXTree 无障碍树定位、纯视觉像素定位与 Xvfb/noVNC 虚拟桌面架构、间接注入防护与人机协同接管（HITL）
- **系统提示词与上下文工程**：四大主流 Agent 系统提示词源码级横评（因模施教、缓存边界切分、行动偏置）与工业级设计法则
