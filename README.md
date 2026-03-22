# 伴你左右

一个面向日常生活的 Web 小助手：左侧是 **3D 数字人（VRM）**，右侧是 **聊天、语音、图片、待办提醒** 等区域。技术栈为 **Next.js + React + TypeScript**，大模型通过阿里云 **DashScope（兼容 OpenAI 接口）** 调用。

---

## 你能用它做什么（功能说明）

| 功能 | 说明 |
|------|------|
| **文字聊天** | 在输入框打字，按 **Enter** 发送（**Shift+Enter** 换行）。助手会用大模型回复。 |
| **语音输入** | 点麦克风：浏览器会用 **语音识别** 把你说的话转成文字；结束后会请求大模型 **润色**（加标点、断句、纠错）。需要 **Chrome / Edge** 等支持 Web Speech API 的浏览器，且建议使用 **localhost** 或 **HTTPS**，并允许 **麦克风** 权限。 |
| **朗读助手** | 用浏览器 **语音合成** 朗读 **最近一条助手文字回复**。 |
| **图片** | 上传图片，并选择模式：**图片描述**、**提取文字（OCR）**、**分析建议**。图片会以 base64 发给大模型（需支持视觉的模型，见下文环境变量）。 |
| **表情包** | 点击表情按钮，当作一条消息发给助手。 |
| **待办提醒** | 填写待办标题和时间，点「添加提醒」；到时间会 **弹出提示**。也可在聊天里发带「提醒、几点、闹钟」等字眼的内容，系统会尝试让大模型 **解析成待办**（解析成功会弹窗提示）。 |
| **数字人** | 左侧区域可 **拖拽或选择上传 `.vrm` 文件** 加载 3D 角色；可用鼠标 **旋转视角**（轨道控制器）。 |

---

## 如何在自己电脑上运行

1. 安装 [Node.js](https://nodejs.org/)（建议长期支持版）。
2. 在项目根目录打开终端，执行：

```bash
npm install
npm run dev
```

3. 浏览器打开：[http://localhost:3000](http://localhost:3000)

其他常用命令：

- `npm run build` — 构建生产版本  
- `npm run start` — 运行构建后的服务  
- `npm run lint` — 代码检查  

---

## 环境变量（必须配置大模型才能聊天）

在项目根目录新建 **`.env.local`**（不要提交到 Git），至少配置 **API Key**：

| 变量名 | 是否必填 | 说明 |
|--------|----------|------|
| `ALIBABA_API_KEY` 或 `DASHSCOPE_API_KEY` | **必填** | 阿里云 DashScope API Key，用于 `/api/chat` 转发请求。 |
| `DASHSCOPE_MODEL` | 可选 | 纯文本对话模型，默认 `qwen-plus`。 |
| `DASHSCOPE_VL_MODEL` | 可选 | 带图片时的视觉模型，默认 `qwen-vl-plus`。 |
| `DASHSCOPE_BASE_URL` | 可选 | 兼容模式接口地址，默认 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`。 |
| `RETURN_UPSTREAM_RAW` | 可选 | 设为 `1` 时，接口响应里会附带上游原始 JSON（调试用）。 |

未配置 Key 时，访问聊天相关接口会返回 **500** 并提示缺少 Key。

---

## 后端接口说明（`/api/chat`）

供页面与扩展功能调用：**POST**，`Content-Type: application/json`。

**通用字段**

- `messages`（必填）：数组，元素形如 `{ "role": "user" \| "assistant" \| "system", "text"?: string, "imageDataUrl"?: string }`。  
- `purpose`（可选）：  
  - 不传或 `chat`：普通多轮对话（可含图片）。  
  - `voice_polish`：仅对语音转写结果做润色。  
  - `todo_extract`：从用户话里抽取待办，返回应为 JSON 字符串。  
- `model`、`temperature`、`max_tokens`（可选）：覆盖默认参数。

**成功时响应（JSON）**

- `reply`：字符串，模型返回的正文（润色、抽取、聊天都走此字段）。  
- `raw`：仅当 `RETURN_UPSTREAM_RAW=1` 时可能存在，上游完整响应。

**错误时**  

- HTTP 4xx/5xx，`error` 等字段说明原因（如缺 Key、上游错误摘要）。

---

## 项目结构（方便找人改哪里）

- `app/page.tsx` — 主界面：聊天、语音、图片、待办、与大模型交互逻辑。  
- `app/components/DigitalHumanModule.tsx` — Three.js + VRM 数字人画布与上传。  
- `app/api/chat/route.ts` — 服务端转发 DashScope，处理 `purpose` 与模型选择。  
- `app/layout.tsx`、`app/globals.css` — 全局布局与样式。  

---

## 已知限制与改进方向

- **待办与聊天记录** 目前主要在浏览器内存中，刷新页面会丢失；若需要长期保存，可后续接入账号与数据库。  
- **语音识别** 依赖浏览器与网络，不同设备表现不一致；若失败请看页面上的「语音诊断」提示。  
- **数字人** 需自行准备合规的 `.vrm` 模型文件；大模型与 API 用量、计费以阿里云控制台为准。  
- 若部署到公网，务必使用 **HTTPS**，并妥善保管 **`.env.local`**，不要泄露 Key。

---

## 延伸阅读

- [Next.js 文档](https://nextjs.org/docs)  
- [DashScope 兼容 OpenAI 接口说明](https://help.aliyun.com/zh/dashscope/)（以官网最新文档为准）  
