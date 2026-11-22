> [!FOCUS] 为什么工具定义（Tool Schema & Description）本身就是“半个系统提示词”？
> 每次调大模型时，**每个工具的 `name`、`description`（工具提示词）和 `parameters` 都会作为系统上下文一起发给模型**。工具设计得好坏，直接决定模型会不会用错参数、会不会爆输出、以及每轮要白白烧掉多少 Schema Token。

---

## 1. 四家内置工具规模与设计哲学总览

| Agent | 内置工具规模 | 核心设计哲学 | 最具代表性的工具巧思 |
|---|---|---|---|
| **[Pi](#/pi/overview)** | **极简 7 个**（默认仅启用 4 个） | 只给最小原子原语，搜索/列目录默认交由 `bash` | 超长输出自动落盘临时文件并返回 `full_output_path` |
| **[Codex](#/codex/overview)** | **精炼 ~12 个**（无独立 `read`/`grep`/`ls`） | 读文件与搜索统一走 `exec_command`；写代码靠专用补丁 | **Freeform 自由格式 `apply_patch`**（不包 JSON 防转义出错）+ `exec_command` 持久化 PTY 与每命令提权参数 |
| **[OpenCode](#/opencode/overview)** | **均衡 ~20 个** | 专用文件/搜索工具齐全，减少模型手写复杂 Shell | `read` 兼顾读文件与列目录；`shell` 超时自动转后台；`subagent` 支持向已完成子 Agent 追问 |
| **[OpenClaw](#/openclaw/overview)** | **全栈 40+ 个**（按 12 个 `group:*` 管理） | 覆盖 IM 消息、定时任务、记忆、浏览器、桌面与多模态 | 工具按 `group:runtime`/`fs`/`memory`/`ui`/`messaging` 分组授权 + 延迟 `tool_search` 防 Schema 撑爆 |

---

## 2. Pi：极简 7 件套（完整清单与原文工具提示词）

来源：`earendil-works/pi` → `packages/coding-agent/src/core/tools/*.ts`

| 工具名 | 工具提示词（核心原文 + 中文） | 关键参数 |
|---|---|---|
| **`read`** | *"Read the contents of a file. Supports text files and images. Output is truncated to max lines or KB. Use offset/limit for large files."*<br>读取文本或图片；超长自动截断，大文件用 `offset`/`limit` 分页续读。 | `path`（必填）、`offset?`（起始行，1-based）、`limit?`（最大行数） |
| **`edit`** | *"Make surgical edits to files."*<br>对文件做精准局部替换。 | `path`（必填）、`edits[]`（每项含 `oldText`、`newText`） |
| **`write`** | *"Create or overwrite files."*<br>创建新文件或整文件覆盖。 | `path`（必填）、`content`（必填） |
| **`bash`**（Win 为 `powershell`） | *"Execute a shell command in cwd. Output is truncated to last N lines or KB. If truncated, full output is saved to a temp file."*<br>执行命令；输出截尾，完整日志存临时文件并在返回值给 `full_output_path`。 | `command`（必填）、`timeout?`（超时秒数，默认无超时） |
| **`grep`** | *"Search file contents for a pattern. Respects .gitignore."*<br>按正则或字面量搜文件内容，自动遵守 `.gitignore`。 | `pattern`（必填）、`path?`、`glob?`、`ignoreCase?`、`literal?`、`context?`、`limit?` |
| **`find`** | *"Search for files by glob pattern. Respects .gitignore."*<br>按 glob 模式查找文件路径。 | `pattern`（必填）、`path?`、`limit?` |
| **`ls`** | *"List directory contents sorted alphabetically, includes dotfiles."*<br>按字母序列表目录，含隐藏文件，目录带 `/` 后缀。 | `path?`、`limit?` |

---

## 3. Codex：高密度 Coding 专用工具（无独立 `read`/`grep`）

来源：`openai/codex` → `codex-rs/core/src/tools/handlers/*_spec.rs`

| 工具名 | 工具提示词（核心原文 + 中文） | 关键参数 |
|---|---|---|
| **`exec_command`** | *"Runs a command in a PTY, returning output or a session ID for ongoing interaction."*<br>在持久化 PTY 中运行命令；未在等待时间内结束时返回 `session_id` 供持续交互。 | `cmd`（必填）、`workdir?`、`yield_time_ms?`（默认 10000ms）、`tty?`、`login?`、`sandbox_permissions?`（`use_default` / `with_additional_permissions` / `require_escalated`）、`additional_permissions?`、`prefix_rule?` |
| **`write_stdin`** | 向仍在运行的 `exec_command` 会话发送标准输入或继续轮询输出。 | `session_id`（必填）、`chars?`、`yield_time_ms?` |
| **`apply_patch`** | *"The `apply_patch` tool can be used to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON."*<br>自由格式补丁工具（**不包裹 JSON**），直接输出结构化 diff 块增删改文件。 | 自由文本补丁载荷（`*** Begin Patch` … `*** End Patch`） |
| **`update_plan`** | *"Updates the task plan."*<br>维护多步任务清单及每步状态（`pending` / `in_progress` / `completed`）。 | `explanation?`、`plan[]`（`step`、`status`） |
| **`request_permissions`** | *"Request additional filesystem or network permissions from the user and wait for the client to grant a subset..."*<br>向用户申请额外目录或网络权限（支持当前回合或整个会话生效）。 | `permissions`（文件系统/网络范围）、`environment_id?` |
| **`request_user_input`** | 向用户发起结构化提问等待决策。 | `questions[]`（问题与选项） |
| **`view_image`** | 查看本地图片文件以进行多模态分析。 | `path`（图片路径） |
| **`tool_search`** | 按需检索并动态激活延迟加载的扩展/MCP 工具。 | `query`、`limit?` |
| **多 Agent 与窗口控制** | `multi_agents`（派生/通信/等待子 Agent）、`get_context_remaining`、`new_context_window`、`list_available_plugins_to_install`、`request_plugin_install` | 对应角色/任务参数与插件标识 |

---

## 4. OpenCode：均衡全能 20+ 工具

来源：`anomalyco/opencode` → `packages/core/src/tool/plugin/*.ts`

| 分类 | 内置工具 | 核心工具提示词与关键参数 |
|---|---|---|
| **文件与代码编辑** | `read`、`edit`、`write`、`patch`、`file-diff` | `read(path, offset?, limit?)` 同时支持**读文件和列目录**（默认上限 2000 行/项）；`edit(path, oldString, newString, replaceAll?)` 精确替换；`patch` 支持补丁块 |
| **代码与历史检索** | `glob`、`grep`、`session-search` | `glob`/`grep` 查项目代码；`session-search` 全文检索历史会话 |
| **命令执行** | `shell` | `shell(command, workdir?, timeout?, background?)`：**前台超时自动转为后台继续跑**，后台超时则停止，返回 `shellID` 与 `exitCode` |
| **子 Agent 与规划** | `subagent`、`todo`、`question`、`skill` | `subagent(agent, description, prompt, model?, sessionID?)`：传 `sessionID` 可向运行中或已结束的子 Agent 发追问；`todo` 维护任务列表；`skill` 按需加载技能 |
| **联网、媒体与扩展** | `websearch`、`webfetch`、`image-generate`、`video-generate`、`artifact`、`automation`、`mcp-resource`、`browser`（官方插件） | 覆盖网页抓取搜索、多模态生成、产物管理、自动化与浏览器控制 |

---

## 5. OpenClaw：全栈 40+ 工具（12 大策略组）

来源：`openclaw/openclaw` → `docs/gateway/sandbox-vs-tool-policy-vs-elevated.md`（通过 `group:*` 统一做 5 层策略授权）

| 策略分组 | 包含的内置工具 | 架构角色 |
|---|---|---|
| **`group:runtime`** | `exec`（别名 `bash`）、`process`、`code_execution` | 命令执行、后台进程日志/交互/中止、代码模式 |
| **`group:fs`** | `read`、`write`、`edit`、`apply_patch` | 文件读写与补丁编辑（沙箱内经 FsBridge 校验） |
| **`group:sessions`** | `sessions_list`、`sessions_history`、`sessions_search`、`sessions_send`、`sessions_spawn`、`sessions_yield`、`subagents`、`session_status` | 跨会话查询、派生子 Agent、主动挂起等待回报 |
| **`group:memory`** | `memory_search`、`memory_get` | 检索与读取分层记忆（`MEMORY.md` / 每日笔记） |
| **`group:web`** | `web_search`、`x_search`、`web_fetch` | 联网搜索与抓取（触发[轮次内污点传播](#/openclaw/memory/recall-and-security)） |
| **`group:ui`** | `browser`、`screen`、`terminal`、`canvas`、`progress_card`、`show_widget` | 浏览器自动化、面板布局展示（仅展示不点击）、进度卡片与内嵌组件 |
| **`group:messaging`** | `message` | 跨 20+ IM 渠道发送、回复、投票、reaction（`final: true` 可直接终结本轮循环） |
| **`group:nodes`** | `nodes`、`computer` | 手机/桌面节点硬件能力（相机/录屏/定位）与 Computer Use 键鼠操作 |
| **`group:automation`** | `cron`、`gateway` | 定时任务管理与 Gateway 自身配置/重启控制 |
| **`group:agents`** | `agents_list`、`get_goal`、`create_goal`、`update_goal`、`ask_user`、`skill_workshop`、`skill_library` | 多 Agent 名录、长程目标管理、用户提问与技能工坊 |
| **`group:media`** | `view_image`、`image_generate`、`music_generate`、`video_generate`、`tts`、`pdf` | 图像/音视频/语音合成与 PDF 解析 |
| **`group:plugins`** | 所有插件自有工具与 `bundle-mcp` 暴露的 MCP 工具 | 统一纳入沙箱二次白名单审批 |

---

## 6. 三个最值得借鉴的工具设计巧思

1. **编辑工具的两条流派**：
   - **JSON 精确替换（Pi / OpenCode `edit`）**：参数极其直观（`oldString` → `newString`），通用模型极易学会；
   - **Freeform 自由补丁（Codex `apply_patch`）**：彻底跳过 JSON 字符串转义（修改含大量引号/反斜杠的代码时错误率骤降），适合经过联合训练的模型。
2. **大输出防撑爆（Truncation + Temp File）**：Pi、OpenCode、OpenClaw 都不会把 10 万行测试日志直接塞回模型，而是**截断返回首尾 + 把全量日志落盘到临时路径**，让模型按需用 `read(offset, limit)` 或 `grep` 精准查。
3. **工具数量膨胀时的治本之策（`tool_search` 延迟发现）**：当内置工具 + MCP 工具超过几十个时，全量塞进请求会疯狂浪费 Input Token 并降低选择准确率——Codex 与 OpenClaw 都引入了 **Tool Search（按需检索再激活 Schema）**，只把核心工具常驻，其余工具按需挂载。
