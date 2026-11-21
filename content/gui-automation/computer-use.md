> [!FOCUS] 常见误解纠偏：Computer Use 绝不是“全靠截图猜坐标”！
> 纯截图只是 Computer Use 的**兜底通用视野**——如果真的一路只靠截屏和点像素，不仅每步都要烧大量图片 Token、延迟极高，而且连滚动条下面、中文输入、窗口后台状态都很难处理。成熟的 Computer Use 体系都是**「四层感知通道 + 混合工具协同 + 独立虚拟桌面」**的组合架构。

![Computer Use 全栈架构：四层感知、混合动作与虚拟桌面](./assets/computer-use-stack.svg)

---

## 1. 四层感知通道：Computer Use 到底怎么“看懂”电脑？

| 感知通道 | 拿到什么信息 | 优势与局限 |
|---|---|---|
| **① 屏幕视觉像素（Screenshot）** | 整屏缩放归一化截图（如 `1280×800`）+ 按需局部放大裁剪 | **唯一全能兜底**：Electron、游戏、Canvas、系统弹窗通吃；但图片 Token 贵、慢，需靠帧差分（Frame Diff）跳过静止画面 |
| **② OS 无障碍控件树（桌面的 DOM）** | **macOS `AXUIElement`**、**Windows `UI Automation (UIA)`**、**Linux `AT-SPI2`** 暴露的窗口控件树（按钮名、角色、状态、精确矩形框） | **精准且省 Token**：直接拿到控件边界框，还可叠加 [SoM 标号](#/gui-automation/browser-use/set-of-mark) 画到图上；局限是极少数自绘软件（游戏/部分 Canvas）不暴露控件树 |
| **③ 窗口元数据 + 系统剪贴板** | 打开的窗口列表/标题/焦点位置（如 `wmctrl` / `CGWindowList`），以及剪贴板全文 | 零视觉成本知道当前谁在最前面；**读写长文本与中文直接走剪贴板 + `Ctrl/Cmd+V`**，比逐字敲键盘快 100 倍且零乱码 |
| **④ Shell / 文件工具混合协同** | 同一会话同时配备 `bash` + `text_editor` + `computer` 三件套 | **能用命令行解决的事绝不点鼠标**（查文件、跑脚本、改配置全走 Shell），只有最后必须交互的桌面软件才动用 GUI |

---

## 2. 动作原语、报文示例与两个高频实战坑

### 2.1 一次真实的 Computer Use 协议交互（以 [Anthropic Messages](#/llm-protocols/anthropic-messages) 为例）
```json
// 1. 模型基于当前屏幕（或控件树）发出原子键鼠动作
{
  "type": "tool_use",
  "id": "toolu_cu_01",
  "name": "computer",
  "input": {
    "action": "left_click",
    "coordinate": [640, 420]
  }
}

// 2. 执行端注入点击、等待 UI 稳定（约 300–500ms）后返回最新截图校验
{
  "type": "tool_result",
  "tool_use_id": "toolu_cu_01",
  "content": [
    {
      "type": "image",
      "source": { "type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo..." }
    }
  ]
}
```
完整动作集除 `left_click` 外，通常还包括 `double_click`、`triple_click`（选中整行）、`right_click`、`mouse_move`（触发悬停菜单）、`left_click_drag`（拖拽滑块/窗口）、`scroll`、`type` 与组合快捷键 `key("ctrl+s")` / `key("alt+tab")`。

### 2.2 两个极易踩的实战坑
1. **HiDPI / Retina 坐标换算坑**：macOS Retina（2x 缩放）截出来的图是 `2560×1600` 物理像素，但 `CGEvent` 注入点击接受的是 `1280×800` 逻辑点（pt）；执行器必须把模型输出的归一化坐标按**逻辑分辨率**准确换算，否则每次点击都会偏到屏幕左上角。
2. **中文与特殊符号输入坑**：Linux 的 `xdotool type` 遇到中文、Emoji 或复杂符号极易丢字或受输入法干扰；工程上统一改为**先把文本写入系统剪贴板，再注入 `Ctrl+V` / `Cmd+V` 粘贴**。

---

## 3. 生产级执行底座：独立虚拟桌面 + 实时接管

为了不抢占人类本机的物理鼠标键盘、同时守住隔离边界，生产级 Computer Use 普遍运行在**独立虚拟桌面**中：
- **Linux 容器 / 云桌面（主流）**：
  - 虚拟显示：**`Xvfb`**（X11 虚拟帧缓冲，无物理显示器也能跑完整 GUI）或无头 **Wayland** + 轻量窗口管理器（XFCE / Fluxbox）；
  - 键鼠注入：**`xdotool`**（X11）或 **`ydotool` / `/dev/uinput`**（内核虚拟输入设备，不挑显示服务器）；
  - 实时观看与人工接管：**`x11vnc` + `noVNC`** 或低延迟 **WebRTC** 推流到前端，遇 2FA、验证码或支付时人类一键接管（详见 [04 · 安全防线与人机接管](#/gui-automation/security-and-hitl)）。
- **macOS / Windows 本机控制**：分别依赖 `CGEvent`（需辅助功能 + 屏幕录制权限）和 `SendInput` API，适合本机伴生助手，但运行期间会占用用户真实焦点。

### 3.1 屏幕上那个“代替你点击的指针”是怎么做到的？

当你看 Codex 桌面端或 Computer Use 演示时，经常能亲眼看到一个光标滑过去点击按钮（甚至带高亮光圈）。底层主要有**三种实现手段**：

1. **直接驱动真实系统光标（`CGEvent` / `SendInput` / `xdotool`）**：
   - 在 macOS 上通过 `CGEventCreateMouseEvent` + `CGEventPost` 向系统 HID 事件队列注入 `MouseMoved → LeftMouseDown → LeftMouseUp`。操作系统把它当成真实硬件鼠标，所以你会看到系统光标真的移过去点击（通常会做几十毫秒的轨迹插值，让人眼看清操作过程）；代价是会和你的物理鼠标抢焦点。
2. **透明穿透覆盖层画“AI 虚拟指针” + 语义点击 / 瞬间归位**：
   - 桌面宿主在屏幕最顶层盖一个**全屏透明且鼠标穿透的悬浮窗**，专门绘制带标识的 AI 指针轨迹和点击涟漪，让你随时看清 AI 正在点哪；
   - 真正触发点击时：支持无障碍的原生控件优先直接调 **`AXUIElementPerformAction(kAXPressAction)`**（连物理鼠标都不用动！）；必须走坐标点击时，则记下你当前鼠标位置 → 注入点击（或 `CGEventPostToPid` 定向发给目标进程）→ 再归位，尽量减少抢鼠标干扰。
3. **独立虚拟桌面里的专属光标**：
   - 如果跑在独立虚拟桌面（`Xvfb` / 虚拟机 / 云桌面）里，你在预览窗口里看到的是**虚拟系统内部那根独立光标**在动，与你本机的物理鼠标完全隔离，互不打架。
