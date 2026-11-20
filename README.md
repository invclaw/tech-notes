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

- **OpenClaw 架构设计解析**：项目全景、Agent Loop 三层嵌套循环与 Steer 机制、Session 与多 Agent 隔离、分层记忆与 Dreaming、安全模型与五大沙箱后端
- **AI Agent 沙箱技术全景**：L1–L5 五级隔离谱系、三大操作系统（macOS Seatbelt / Linux bwrap+Landlock+Seccomp / Windows AppContainer+Job）内核原理、容器与 gVisor/Kata、MicroVM 与云端沙箱选型
