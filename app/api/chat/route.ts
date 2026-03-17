export const runtime = "nodejs";

type InMessage = {
  role: "system" | "user" | "assistant";
  text?: string;
  imageDataUrl?: string;
};

type Purpose = "chat" | "voice_polish" | "todo_extract";

function getDashScopeKey() {
  // 兼容你现有的 env 命名：ALIBABA_API_KEY
  return process.env.ALIBABA_API_KEY || process.env.DASHSCOPE_API_KEY;
}

function toOpenAIMessage(m: InMessage) {
  const parts: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> =
    [];

  if (m.text) parts.push({ type: "text", text: m.text });
  if (m.imageDataUrl) parts.push({ type: "image_url", image_url: { url: m.imageDataUrl } });

  // 若没有多模态内容，退化为纯文本
  if (parts.length === 0) return { role: m.role, content: "" };
  if (parts.length === 1 && parts[0].type === "text") {
    return { role: m.role, content: parts[0].text ?? "" };
  }
  return { role: m.role, content: parts };
}

export async function POST(req: Request) {
  const key = getDashScopeKey();
  if (!key) {
    return Response.json(
      { error: "Missing API key. Set ALIBABA_API_KEY (or DASHSCOPE_API_KEY) in .env.local." },
      { status: 500 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const purpose: Purpose =
    body?.purpose === "voice_polish"
      ? "voice_polish"
      : body?.purpose === "todo_extract"
        ? "todo_extract"
        : "chat";
  const messages: InMessage[] = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0) {
    return Response.json({ error: "messages is required" }, { status: 400 });
  }

  const hasImage = messages.some((m) => Boolean(m.imageDataUrl));
  const defaultTextModel = process.env.DASHSCOPE_MODEL || "qwen-plus";
  const defaultVisionModel = process.env.DASHSCOPE_VL_MODEL || "qwen-vl-plus";
  const model: string = body?.model || (hasImage ? defaultVisionModel : defaultTextModel);

  const endpoint =
    process.env.DASHSCOPE_BASE_URL ||
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

  const systemForVoicePolish: InMessage = {
    role: "system",
    text:
      "你是中文语音转文字的后处理助手。请对用户的口述文本进行断句、添加标点、纠正常见同音错字，必要时补全主语但不要编造事实。只输出润色后的文本，不要解释，不要加引号，不要加前后缀。",
  };

  const systemForTodoExtract: InMessage = {
    role: "system",
    text:
      '你是待办提醒解析器。请从用户输入中提取一个待办提醒（如果有）。只输出严格 JSON，不要输出多余文字。JSON 结构：{"title": string, "remindAt": string|null}，remindAt 必须是 ISO8601 日期时间（含时区）或 null。若没有提醒意图，输出：{"title":"", "remindAt": null}。当前时间以用户本地时间为准。',
  };

  const upstreamRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages:
        purpose === "voice_polish"
          ? [systemForVoicePolish, ...messages].map(toOpenAIMessage)
          : purpose === "todo_extract"
            ? [systemForTodoExtract, ...messages].map(toOpenAIMessage)
            : messages.map(toOpenAIMessage),
      temperature:
        typeof body?.temperature === "number"
          ? body.temperature
          : purpose === "voice_polish"
            ? 0.2
            : purpose === "todo_extract"
              ? 0
            : 0.7,
      max_tokens: typeof body?.max_tokens === "number" ? body.max_tokens : 1024,
      stream: false,
    }),
  });

  const text = await upstreamRes.text();
  if (!upstreamRes.ok) {
    return Response.json(
      { error: "Upstream error", status: upstreamRes.status, details: text.slice(0, 2000) },
      { status: 502 },
    );
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return Response.json({ error: "Upstream returned non-JSON", details: text.slice(0, 2000) }, { status: 502 });
  }

  const reply: string | undefined = data?.choices?.[0]?.message?.content;
  return Response.json({
    reply: typeof reply === "string" ? reply : "",
    raw: process.env.RETURN_UPSTREAM_RAW === "1" ? data : undefined,
  });
}

