> [!FOCUS] 核心定位
> 当任务跨出浏览器——需要操作 **Excel、微信、本地 IDE、CAD、系统弹窗或老旧桌面 ERP** 时，没有 DOM 可读，只能像真正的人类一样**“看屏幕像素 → 动鼠标敲键盘 → 看变化后的屏幕”**，这就是 **Computer Use**。

---

## 1. 感知与定位（Grounding）的两条路线

1. **纯视觉像素路线（Anthropic Computer Use / OpenAI CUA 主力）**：
   - 运行时截取当前屏幕并**按模型最优分辨率缩放归一化**（例如压到 `1280×800` 或 `1024×768`，既省图片 Token 又避免坐标体系错位）；
   - 多模态模型直接从像素里定位目标按钮的中心坐标 `(x, y)`，输出键鼠动作；
   - 执行器按缩放比例把模型坐标还原为真实屏幕像素并注入点击，随后等待界面稳定再截一张新图回传校验。
2. **混合路线（视觉 + OS 辅助功能树）**：
   - 在 macOS（`AXUIElement`）或 Windows（`UI Automation`）上，可额外拉取原生窗口控件树辅助定位，提高密集表单和菜单项的点击准确率。

---

## 2. 一次真实的 Computer Use 协议交互示例

以 [Anthropic Messages 协议](#/llm-protocols/anthropic-messages) 原生内置的 `computer` 工具为例，一轮「截图 → 定位点击 → 返回新截图」的报文极其直观：

```json
// 1. 模型先请求截屏或直接基于上一帧截图发出坐标动作
{
  "type": "tool_use",
  "id": "toolu_cu_01",
  "name": "computer",
  "input": {
    "action": "left_click",
    "coordinate": [640, 420]
  }
}

// 2. 执行端点击后稍等 UI 渲染，截取最新画面作为 tool_result 返回
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
> 注：由于每步都会产生一张大图，Computer Use 对上下文窗口消耗极快，必须配合 [Anthropic 显式缓存断点](#/llm-protocols/anthropic-messages) 或 [旧截图裁剪/压缩策略](#/codex/core/compaction) 控制成本。

---

## 3. 底层动作注入与虚拟桌面架构

为了不抢占人类正在用的物理鼠标键盘，生产级 Computer Use 通常跑在**独立虚拟桌面**中：

- **Linux 容器 / 云桌面（最主流）**：
  - 虚拟显示服务：**`Xvfb`**（X11 虚拟帧缓冲）或无头 **Wayland** + 轻量窗口管理器（如 Fluxbox / XFCE）；
  - 键鼠事件注入：**`xdotool`**（X11）或 **`ydotool` / `/dev/uinput`**（内核虚拟输入设备，不挑 X11/Wayland）；
  - 实时观看与接管：通过 **`x11vnc` + `noVNC`** 或低延迟 **WebRTC** 把虚拟屏幕推流到前端工作台。
- **macOS / Windows 本机控制**：
  - macOS 通过 `CGEvent`（需系统授予“辅助功能”与“屏幕录制”权限）；Windows 通过 `SendInput` API 注入；适合本机伴生助手，但执行期间会直接占用用户真实键鼠焦点。
