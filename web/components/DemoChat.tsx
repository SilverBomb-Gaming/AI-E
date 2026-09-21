"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { SUGGESTED_PROMPTS } from "@/lib/aie/spine/prompts";
import type { BoundedPlan, ChatMessage, ChatMode, ChatResponse, ToolCallRecord } from "@/lib/aie/spine/types";

type VisibleMessage = ChatMessage & { toolCalls?: ToolCallRecord[] };

function statusTone(status: BoundedPlan["status"]): string {
  switch (status) {
    case "supported_ready":
      return "bg-ocean/10 text-ocean";
    case "bounded_draft":
    case "supported_with_warnings":
      return "bg-sand text-ember";
    case "unsupported_target":
    case "blocked_unsafe":
      return "bg-coral/15 text-ember";
  }
}

function ToolCard({ call }: { call: ToolCallRecord }) {
  const plan = call.result;
  return (
    <article className="mt-3 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <p className="section-label">Tool ran</p>
        <code className="rounded-full bg-mist px-2 py-1 text-xs text-ink">{call.name}</code>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusTone(plan.status)}`}>
          {plan.status}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-ink">{plan.summary}</p>
      <dl className="mt-3 grid gap-2 text-xs body-muted sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-ink">Engine</dt>
          <dd>{plan.intent.engineTarget ?? "unspecified"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Executed engine work</dt>
          <dd>{plan.executed ? "yes" : "no — plan only"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Features</dt>
          <dd>{plan.intent.features.join(", ") || "none extracted"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Review required</dt>
          <dd>{plan.reviewRequired ? "yes" : "no"}</dd>
        </div>
      </dl>
      <ol className="mt-3 space-y-2 text-sm leading-6 text-ink/90">
        {plan.steps.map((step, index) => (
          <li key={step.id}>
            <span className="font-semibold">{index + 1}. {step.title}.</span> {step.detail}
          </li>
        ))}
      </ol>
      {plan.blockedItems.length > 0 ? (
        <p className="mt-3 text-sm text-ember">{plan.blockedItems.join(" ")}</p>
      ) : null}
    </article>
  );
}

export function DemoChat() {
  const [mode, setMode] = useState<ChatMode>("demo");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<VisibleMessage[]>([
    {
      role: "assistant",
      content:
        "This is the public AI-E spine. Ask it to plan a game-dev request. It will run `plan_bounded_request` — a real local planner that can also block unsupported work. It will not pretend to edit Unity.",
    },
  ]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch("/api/demo/status")
      .then(async (response) => {
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { mode?: ChatMode };
        if (payload.mode === "live" || payload.mode === "demo") {
          setMode(payload.mode);
        }
      })
      .catch(() => {
        setMode("demo");
      });
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  const modeLabel = useMemo(
    () => (mode === "live" ? "Live LLM + local planner" : "Demo mode — no private key required"),
    [mode],
  );

  async function send(content: string) {
    const trimmed = content.trim();
    if (!trimmed || pending) {
      return;
    }

    const nextMessages: VisibleMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setPending(true);
    setError(null);

    try {
      const history: ChatMessage[] = nextMessages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({ role: message.role, content: message.content }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const payload = (await response.json()) as ChatResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Chat request failed.");
      }

      setMode(payload.mode);
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: payload.reply,
          toolCalls: payload.toolCalls,
        },
      ]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Chat request failed.");
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(input);
  }

  return (
    <section className="glass-card flex h-[44rem] max-h-[80vh] flex-col rounded-[2rem] shadow-float">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/5 px-5 py-4">
        <div>
          <p className="section-label">Public spine</p>
          <h2 className="headline text-2xl font-semibold">Chat + planner tool</h2>
        </div>
        <span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold text-ocean">{modeLabel}</span>
      </div>

      <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5" aria-live="polite">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-8" : "mr-4"}>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ocean">
              {message.role === "user" ? "You" : "AI-E"}
            </p>
            <div
              className={
                message.role === "user"
                  ? "mt-2 rounded-[1.25rem] bg-ink px-4 py-3 text-sm leading-6 text-white"
                  : "mt-2 rounded-[1.25rem] bg-white/80 px-4 py-3 text-sm leading-6 text-ink"
              }
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.toolCalls?.map((call) => (
                <ToolCard key={call.id} call={call} />
              ))}
            </div>
          </div>
        ))}
        {pending ? <p className="text-sm body-muted">Running the planner…</p> : null}
      </div>

      <div className="space-y-3 border-t border-ink/5 px-5 py-4">
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="rounded-full border border-ink/10 bg-white/80 px-3 py-2 text-left text-xs font-semibold text-ink transition hover:-translate-y-0.5"
              onClick={() => void send(prompt)}
              disabled={pending}
            >
              {prompt}
            </button>
          ))}
        </div>
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="demo-chat-input">
            Message
          </label>
          <input
            id="demo-chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask AI-E to plan a bounded game-dev request"
            className="min-w-0 flex-1 rounded-full border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none ring-coral/30 focus:ring"
            disabled={pending}
          />
          <button
            type="submit"
            className="rounded-full bg-coral px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-ember disabled:opacity-60"
            disabled={pending}
          >
            Send
          </button>
        </form>
        {error ? <p className="text-sm text-ember">{error}</p> : null}
      </div>
    </section>
  );
}
