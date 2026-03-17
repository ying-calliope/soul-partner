"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ChatRole = "me" | "assistant" | "system";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text?: string;
  imageUrl?: string;
  imageDataUrl?: string;
  sticker?: string;
  createdAt: number;
};

type TodoItem = {
  id: string;
  title: string;
  remindAt: number; // epoch ms
  done: boolean;
  fired: boolean;
};

function nowId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function safeHasWebSpeech() {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
    speechSynthesis?: SpeechSynthesis;
  };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: nowId("m"),
      role: "assistant",
      text: "您好，我是您的生活助手，现在开始美好的一天吧，吃早饭了么！",
      createdAt: Date.now(),
    },
  ]);
  const [draft, setDraft] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isPolishingVoice, setIsPolishingVoice] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [imageMode, setImageMode] = useState<"describe" | "ocr" | "advice">("describe");

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [todoTitle, setTodoTitle] = useState("");
  const [todoTime, setTodoTime] = useState(""); // "HH:MM"

  const [toast, setToast] = useState<{ title: string; body: string } | null>(
    null,
  );

  const listRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const voiceBaseDraftRef = useRef("");
  const voiceInterimRef = useRef("");
  const voiceFinalRef = useRef("");
  const polishingAbortRef = useRef<AbortController | null>(null);

  const stickers = useMemo(
    () => ["(≧▽≦)", "( •̀ ω •́ )", "(ง •_•)ง", "（づ￣3￣）づ", "QAQ", "٩(ˊᗜˋ*)و"],
    [],
  );

  useEffect(() => {
    document.title = "伴你左右";
  }, []);

  useEffect(() => {
    // 自动滚动到底部
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    // 待办提醒：每秒检查一次，触发弹窗 toast
    const t = window.setInterval(() => {
      const now = Date.now();
      setTodos((prev) => {
        let changed = false;
        const next = prev.map((x) => {
          if (!x.done && !x.fired && x.remindAt <= now) {
            changed = true;
            return { ...x, fired: true };
          }
          return x;
        });
        const firedNow = next.find((x) => !x.done && x.fired && x.remindAt <= now);
        if (firedNow) {
          setToast({
            title: "待办提醒",
            body: `${firedNow.title}（${formatTime(firedNow.remindAt)}）`,
          });
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    // 初始化语音识别（Web Speech API）
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      SpeechRecognition?: any;
      webkitSpeechRecognition?: any;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev: any) => {
      let interim = "";
      let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const piece = ev.results[i][0]?.transcript ?? "";
        if (ev.results[i]?.isFinal) finalText += piece;
        else interim += piece;
      }
      if (finalText) voiceFinalRef.current += finalText;
      voiceInterimRef.current = interim;
      setDraft(`${voiceBaseDraftRef.current}${voiceFinalRef.current}${voiceInterimRef.current}`);
    };
    rec.onerror = (e: any) => {
      setVoiceError(e?.error ? `语音识别失败：${e.error}` : "语音识别失败");
      setIsListening(false);
    };
    rec.onend = () => {
      setIsListening(false);
      const raw = `${voiceFinalRef.current}${voiceInterimRef.current}`.trim();
      voiceInterimRef.current = "";
      voiceFinalRef.current = "";
      if (!raw) return;

      // 用已接入的大模型做断句/加标点/纠错（更接近微信输入体验）
      polishingAbortRef.current?.abort();
      const ac = new AbortController();
      polishingAbortRef.current = ac;
      setIsPolishingVoice(true);

      (async () => {
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              purpose: "voice_polish",
              messages: [{ role: "user", text: raw }],
            }),
            signal: ac.signal,
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            setToast({
              title: "语音润色失败",
              body: data?.error ? String(data.error) : `HTTP ${res.status}`,
            });
            return;
          }
          const polished =
            typeof data?.reply === "string" && data.reply.trim() ? data.reply.trim() : raw;
          setDraft((d) => {
            // 只替换本次语音那段（基于 baseDraftRef）
            const base = voiceBaseDraftRef.current;
            return `${base}${base && !base.endsWith("\n") ? "\n" : ""}${polished}`;
          });
        } catch (e: any) {
          if (e?.name === "AbortError") return;
          setToast({
            title: "语音润色失败",
            body: e?.message ? String(e.message) : "网络错误",
          });
        } finally {
          setIsPolishingVoice(false);
        }
      })();
    };
    recognitionRef.current = rec;
  }, []);

  function pushMessage(msg: Omit<ChatMessage, "id" | "createdAt">) {
    setMessages((prev) => [
      ...prev,
      { ...msg, id: nowId("m"), createdAt: Date.now() },
    ]);
  }

  function buildConvo(extra?: { role: "user" | "assistant"; text?: string; imageDataUrl?: string }) {
    const mapped = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "me" ? ("user" as const) : ("assistant" as const),
        text: m.sticker ? m.sticker : m.text,
        imageDataUrl: m.imageDataUrl,
      }));
    return extra ? [...mapped, extra] : mapped;
  }

  async function callLLM(convo: Array<{ role: "user" | "assistant"; text?: string; imageDataUrl?: string }>) {
    setIsReplying(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: convo }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        pushMessage({
          role: "assistant",
          text: data?.error
            ? `连接大模型失败：${data.error}`
            : `连接大模型失败（HTTP ${res.status}）`,
        });
        return null;
      }
      const reply =
        typeof data?.reply === "string" && data.reply.trim() ? data.reply : "（大模型未返回内容）";
      pushMessage({ role: "assistant", text: reply });
      return reply;
    } catch (e: any) {
      pushMessage({
        role: "assistant",
        text: e?.message ? `连接大模型失败：${e.message}` : "连接大模型失败",
      });
      return null;
    } finally {
      setIsReplying(false);
    }
  }

  async function tryExtractTodoFromText(text: string) {
    const t = text.trim();
    if (!t) return;
    // 只对明显提醒意图尝试解析，避免每条消息都打一次模型
    const maybeReminder =
      t.includes("提醒") || t.startsWith("提醒我") || t.includes("闹钟") || t.includes("几点") || t.includes("定时");
    if (!maybeReminder) return;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "todo_extract",
          messages: [{ role: "user", text: t }],
        }),
      });
      const data = await res.json().catch(() => null);
      const raw = typeof data?.reply === "string" ? data.reply : "";
      if (!res.ok || !raw) return;
      const parsed = JSON.parse(raw) as { title?: string; remindAt?: string | null };
      const title = (parsed.title || "").trim();
      const iso = parsed.remindAt ?? null;
      if (!title || !iso) return;
      const when = Date.parse(iso);
      if (!Number.isFinite(when)) return;
      const item: TodoItem = {
        id: nowId("t"),
        title,
        remindAt: when,
        done: false,
        fired: false,
      };
      setTodos((prev) => [item, ...prev]);
      setToast({ title: "已识别待办提醒", body: `${title}（${formatTime(when)}）` });
    } catch {
      // ignore
    }
  }

  function sendText() {
    const text = draft.trim();
    if (!text) return;
    pushMessage({ role: "me", text });
    setDraft("");
    const convo = buildConvo({ role: "user", text });
    void callLLM(convo);
    void tryExtractTodoFromText(text);
  }

  function sendSticker(s: string) {
    pushMessage({ role: "me", sticker: s });
    const convo = buildConvo({ role: "user", text: s });
    void callLLM(convo);
  }

  async function speakLastAssistant() {
    const w = window as unknown as { speechSynthesis?: SpeechSynthesis };
    const synth = w.speechSynthesis;
    if (!synth) return;
    const last = [...messages].reverse().find((m) => m.role === "assistant" && m.text);
    if (!last?.text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(last.text);
    u.lang = "zh-CN";
    synth.speak(u);
  }

  function toggleListen() {
    setVoiceError(null);
    const rec = recognitionRef.current;
    if (!rec) {
      setVoiceError("当前浏览器不支持语音识别（Web Speech API）。");
      return;
    }
    if (isListening) {
      try {
        rec.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
      return;
    }
    try {
      polishingAbortRef.current?.abort();
      setIsPolishingVoice(false);
      voiceBaseDraftRef.current = draft ? `${draft.trimEnd()}${draft.endsWith("\n") ? "" : "\n"}` : "";
      voiceInterimRef.current = "";
      voiceFinalRef.current = "";
      setDraft(voiceBaseDraftRef.current);
      rec.start();
      setIsListening(true);
    } catch (e: any) {
      setVoiceError(e?.message ? `语音识别启动失败：${e.message}` : "语音识别启动失败");
      setIsListening(false);
    }
  }

  // 语音模式：点击开始识别，再次点击停止识别（停止后会走 onend -> 大模型润色）

  function MicrophoneIcon({ active }: { active: boolean }) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 14.5c1.93 0 3.5-1.57 3.5-3.5V6.5C15.5 4.57 13.93 3 12 3S8.5 4.57 8.5 6.5V11c0 1.93 1.57 3.5 3.5 3.5Z"
          stroke={active ? "var(--brand)" : "currentColor"}
          strokeWidth="1.8"
        />
        <path
          d="M6.5 10.8v.5c0 3.03 2.47 5.5 5.5 5.5s5.5-2.47 5.5-5.5v-.5"
          stroke={active ? "var(--brand)" : "currentColor"}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M12 16.8V21"
          stroke={active ? "var(--brand)" : "currentColor"}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M9 21h6"
          stroke={active ? "var(--brand)" : "currentColor"}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  function onPickImage(file: File | null) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : undefined;
      pushMessage({
        role: "me",
        imageUrl: url,
        imageDataUrl: dataUrl,
        text: file.name,
      });
      const prompt =
        imageMode === "describe"
          ? "请描述这张图片的主要内容，并用 3-5 条要点总结。"
          : imageMode === "ocr"
            ? "请尽可能提取图片中的文字内容（如有），按段落输出。"
            : "请分析这张图片反映的场景或问题，并给出 3 条可执行建议。";
      const convo = buildConvo({ role: "user", text: `${file.name}\n${prompt}`, imageDataUrl: dataUrl });
      void callLLM(convo);
    };
    reader.readAsDataURL(file);
  }

  function addTodo() {
    const title = todoTitle.trim();
    if (!title) return;
    const base = new Date();
    let remindAt = Date.now() + 10 * 60 * 1000; // 默认 10 分钟后
    if (todoTime) {
      const [hh, mm] = todoTime.split(":").map((x) => Number(x));
      if (Number.isFinite(hh) && Number.isFinite(mm)) {
        const dt = new Date(
          base.getFullYear(),
          base.getMonth(),
          base.getDate(),
          hh,
          mm,
          0,
          0,
        );
        // 若选的是过去时间，则默认顺延到明天
        if (dt.getTime() <= Date.now()) dt.setDate(dt.getDate() + 1);
        remindAt = dt.getTime();
      }
    }
    const item: TodoItem = {
      id: nowId("t"),
      title,
      remindAt,
      done: false,
      fired: false,
    };
    setTodos((prev) => [item, ...prev]);
    setTodoTitle("");
    setTodoTime("");
    setToast({ title: "已添加待办", body: `${title}（${formatTime(remindAt)}）` });
  }

  function toggleTodo(id: string) {
    setTodos((prev) => prev.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));
  }

  function removeTodo(id: string) {
    setTodos((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <div className="dash">
      <div className="shell">
        {/* 左侧：预留数字人区域（占 1/4） */}
        <section className="card">
          <div className="cardHeader">
            <div>
              <div className="title">您的伙伴小庆</div>
              <div className="subtitle">数字人区域</div>
            </div>
          </div>
          <div className="cardBody">
            <div className="muted" style={{ lineHeight: "24px" }}>
              这里将用于后续接入数字人（视频/3D/Canvas/RTC）。
            </div>
            <div
              style={{
                marginTop: "16px",
                height: "520px",
                borderRadius: "16px",
                border: "1px dashed var(--border)",
                background:
                  "linear-gradient(135deg, rgba(180,83,9,.10), rgba(124,45,18,.06))",
                display: "grid",
                placeItems: "center",
              }}
            >
              <div className="muted">数字人占位画面</div>
            </div>
          </div>
        </section>

        {/* 右侧：聊天大语言模型（占 3/4） */}
        <section className="card chatWrap">
          <div className="cardHeader">
            <div>
              <div className="title">伴你左右生活区</div>
              <div className="subtitle">语音 / 打字 / 图片 / 表情包 + 待办提醒</div>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button className="btn" onClick={speakLastAssistant} type="button">
                朗读助手
              </button>
            </div>
          </div>

          <div className="messages" ref={listRef}>
            {voiceError ? (
              <div className="msgRow">
                <div className="bubble">
                  <div style={{ fontWeight: 700 }}>提示</div>
                  <div className="msgMeta">{voiceError}</div>
                </div>
              </div>
            ) : null}

            {messages.map((m) => (
              <div
                key={m.id}
                className={`msgRow ${m.role === "me" ? "me" : ""}`}
              >
                <div className={`bubble ${m.role === "me" ? "me" : ""}`}>
                  {m.sticker ? (
                    <div style={{ fontSize: "22px", lineHeight: "30px" }}>
                      {m.sticker}
                    </div>
                  ) : null}
                  {m.text ? (
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: "24px" }}>
                      {m.text}
                    </div>
                  ) : null}
                  {m.imageUrl ? (
                    <div style={{ marginTop: "10px" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.imageUrl}
                        alt={m.text || "uploaded"}
                        style={{
                          width: "100%",
                          maxWidth: "420px",
                          borderRadius: "14px",
                          border: "1px solid var(--border)",
                          display: "block",
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="msgMeta">
                    {m.role === "me" ? "你" : "助手"} · {formatTime(m.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="composer">
            <div className="toolbar">
              <div className="toolbarLeft">
                <label className="btn" style={{ display: "inline-flex", gap: 8 }}>
                  上传图片
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
                  />
                </label>

                <select
                  className="select"
                  value={imageMode}
                  onChange={(e) => setImageMode(e.target.value as any)}
                  aria-label="图片处理模式"
                  style={{ width: 180 }}
                >
                  <option value="describe">图片描述</option>
                  <option value="ocr">提取文字</option>
                  <option value="advice">分析建议</option>
                </select>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {stickers.map((s) => (
                    <button
                      key={s}
                      className="btn"
                      type="button"
                      onClick={() => sendSticker(s)}
                      title="发送表情包"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <span className="chip">待办提醒会在右下角弹出</span>
            </div>

            <div className="composerRow">
              <textarea
                className="textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  isListening
                    ? "正在聆听…松开麦克风结束"
                    : isPolishingVoice
                      ? "正在用大模型优化语音文本…"
                      : isReplying
                        ? "大模型正在回复…"
                      : "输入消息…（Enter 发送，Shift+Enter 换行）"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendText();
                  }
                }}
              />
              <button
                className={`btn ${isListening ? "btnPrimary" : ""}`}
                onClick={toggleListen}
                type="button"
                aria-pressed={isListening}
                aria-label={isListening ? "停止语音识别" : "开始语音识别"}
                title={
                  safeHasWebSpeech()
                    ? isListening
                      ? "点击停止"
                      : "点击开始"
                    : "浏览器不支持语音识别"
                }
                disabled={!safeHasWebSpeech() || isPolishingVoice}
                style={{
                  width: "48px",
                  height: "48px",
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "999px",
                  opacity: !safeHasWebSpeech() ? 0.6 : 1,
                }}
              >
                <MicrophoneIcon active={isListening} />
              </button>
              <button className="btn btnPrimary" onClick={sendText} type="button">
                发送
              </button>
            </div>

            {/* 待办事项与提醒 */}
            <div
              style={{
                marginTop: "8px",
                borderTop: "1px solid var(--border)",
                paddingTop: "16px",
                display: "grid",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <input
                  className="input"
                  value={todoTitle}
                  onChange={(e) => setTodoTitle(e.target.value)}
                  placeholder="添加待办（例如：18:30 喝水 / 复盘 / 休息）"
                />
                <input
                  className="input"
                  style={{ maxWidth: "160px" }}
                  type="time"
                  value={todoTime}
                  onChange={(e) => setTodoTime(e.target.value)}
                  aria-label="提醒时间"
                />
                <button className="btn" type="button" onClick={addTodo}>
                  添加提醒
                </button>
              </div>

              <div style={{ display: "grid", gap: "8px" }}>
                {todos.length === 0 ? (
                  <div className="muted">暂无待办。添加后会定时弹出提醒。</div>
                ) : (
                  todos.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto",
                        gap: "12px",
                        alignItems: "center",
                        padding: "12px 14px",
                        borderRadius: "16px",
                        border: "1px solid var(--border)",
                        background:
                          "color-mix(in srgb, var(--panel) 90%, transparent)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={t.done}
                        onChange={() => toggleTodo(t.id)}
                        aria-label="完成待办"
                      />
                      <div>
                        <div
                          style={{
                            fontWeight: 700,
                            textDecoration: t.done ? "line-through" : "none",
                            opacity: t.done ? 0.7 : 1,
                            lineHeight: "22px",
                          }}
                        >
                          {t.title}
                        </div>
                        <div className="msgMeta">
                          提醒时间：{formatTime(t.remindAt)}
                          {t.fired && !t.done ? " · 已提醒" : ""}
                        </div>
                      </div>
                      <button
                        className="btn btnDanger"
                        type="button"
                        onClick={() => removeTodo(t.id)}
                      >
                        删除
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          <div className="toastTitle">{toast.title}</div>
          <div className="toastBody">{toast.body}</div>
          <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
            <button className="btn btnPrimary" onClick={() => setToast(null)} type="button">
              知道了
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
