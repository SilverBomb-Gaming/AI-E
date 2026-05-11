"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { loadGameDevSessionContext, saveGameDevSessionContext } from "@/lib/aie/gameDevChat/gameDevDurableSessionStore";
import { createInitialGameDevSessionContext } from "@/lib/aie/gameDevChat/gameDevSessionContext";
import { planGameDevChatResponse } from "@/lib/aie/gameDevChat/gameDevResponsePlanner";
import type { GameDevChatMessage, GameDevSessionContext } from "./gameDevChatTypes";

const starterPrompts = [
  "I want my player jump to feel less floaty.",
  "Help me add a basic enemy patrol system.",
  "I have an idea for a game but I don't know how to explain it.",
  "Make me a Codex handoff for adding a basic collectible system in Unity.",
];

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function renderMarkdownLite(content: string) {
  return content.split("\n").map((line, index) => {
    if (line.startsWith("# ")) {
      return <h3 key={index} className="mt-3 text-base font-semibold text-slate-950">{line.slice(2)}</h3>;
    }
    if (line.startsWith("## ")) {
      return <h4 key={index} className="mt-3 text-sm font-semibold text-slate-900">{line.slice(3)}</h4>;
    }
    if (line.startsWith("- ")) {
      return <p key={index} className="ml-4 text-sm leading-6 text-slate-700">• {line.slice(2)}</p>;
    }
    if (!line.trim()) {
      return <div key={index} className="h-2" />;
    }
    return <p key={index} className="text-sm leading-6 text-slate-700">{line}</p>;
  });
}

function routingLabel(route: GameDevChatMessage["route"]): string {
  if (!route) {
    return "Conversational";
  }
  if (route.conversationMode && route.conversationMode !== "GAME_DEV_TASK" && route.conversationMode !== "CODEX_HANDOFF_REQUEST") {
    return "Conversational";
  }
  return route.unityFirst ? "Unity-first" : "General";
}

export function GameDevChatClient() {
  const [messages, setMessages] = useState<GameDevChatMessage[]>([]);
  const [sessionContext, setSessionContext] = useState<GameDevSessionContext>(() => createInitialGameDevSessionContext());
  const [draft, setDraft] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const latestRoute = latestAssistant?.route;
  const scaffoldStatus = latestAssistant ? "✅ SESSION_CONTEXT_AND_CONVERSATION_MEMORY_PHASE1" : "Ready for session-scoped chat";

  useEffect(() => {
    setSessionContext(loadGameDevSessionContext(window.localStorage));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isThinking]);

  const canSend = draft.trim().length > 0 && !isThinking;

  const modeSummary = useMemo(() => ({
    conversationMode: latestRoute?.conversationMode ?? latestRoute?.mode ?? "Waiting for message",
    taskMode: latestRoute?.taskMode,
    intent: latestRoute?.detectedIntent ?? "No intent classified yet",
    route: latestRoute ? routingLabel(latestRoute) : "Conversational",
    safety: latestRoute?.safetyStatus ?? "SAFE_PLANNING_ONLY",
    next: latestRoute?.suggestedNextAction ?? "Send a natural game-development message.",
    memoryStatus: sessionContext.scaffoldStatus,
    memoryScope: sessionContext.memoryScope,
    activeSystem: sessionContext.activeGameplaySystem ?? "No active gameplay system yet",
    currentTask: sessionContext.currentImplementationTask ?? "No active task yet",
    latestHandoff: sessionContext.latestCodexHandoffTopic ?? "No Codex handoff in this session yet",
  }), [latestRoute, sessionContext]);

  function submitMessage(nextMessage?: string) {
    const content = (nextMessage ?? draft).trim();
    if (!content || isThinking) {
      return;
    }

    const now = new Date().toISOString();
    const userMessage: GameDevChatMessage = {
      id: createId("user"),
      role: "user",
      content,
      createdAt: now,
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setIsThinking(true);
    const previousRoute = latestAssistant?.route;
    const currentSessionContext = sessionContext;

    window.setTimeout(() => {
      const response = planGameDevChatResponse(content, { previousRoute, sessionContext: currentSessionContext });
      const assistantMessage: GameDevChatMessage = {
        id: createId("assistant"),
        role: "assistant",
        content: response.assistantMessage,
        route: response.route,
        codexHandoff: response.codexHandoff,
        developmentCampaign: response.developmentCampaign,
        sessionContext: response.sessionContext,
        createdAt: new Date().toISOString(),
      };
      const persistedContext = saveGameDevSessionContext(window.localStorage, response.sessionContext);
      assistantMessage.sessionContext = persistedContext;
      setSessionContext(persistedContext);
      setMessages((current) => [...current, assistantMessage]);
      setIsThinking(false);
    }, 220);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl gap-4 px-4 py-5 lg:px-6">
        <section className="flex min-h-[calc(100vh-2.5rem)] flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <header className="border-b border-slate-200 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">AI-E Game Dev Chat</p>
            <div className="mt-1 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Talk naturally. Build safely.</h1>
                <p className="mt-1 max-w-2xl text-sm text-slate-600">AI-E understands conversational state first, keeps session-scoped context in memory, then routes game-dev tasks Unity-first without pretending it edited files.</p>
              </div>
              <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">{scaffoldStatus}</span>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-5">
            {messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-3xl flex-col justify-center py-16">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                  <h2 className="text-lg font-semibold text-slate-950">What are we making today?</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Say hello, ask what AI-E can do, continue a thread, refine the last idea, use the last handoff, report a failed attempt, or ask for tuning, bugs, design ideas, Unity planning, or a Codex handoff.</p>
                  <div className="mt-4 grid gap-2 md:grid-cols-2">
                    {starterPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => submitMessage(prompt)}
                        className="rounded-md border border-slate-200 bg-white px-3 py-3 text-left text-sm text-slate-700 transition hover:border-sky-300 hover:bg-sky-50"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-3xl flex-col gap-4">
                {messages.map((message) => (
                  <article key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[88%] rounded-lg px-4 py-3 ${message.role === "user" ? "bg-slate-950 text-white" : "border border-slate-200 bg-slate-50 text-slate-900"}`}>
                      <div className={message.role === "user" ? "whitespace-pre-wrap text-sm leading-6 text-white" : "space-y-0"}>
                        {message.role === "user" ? message.content : renderMarkdownLite(message.content)}
                      </div>
                      {message.route && (
                        <div className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 md:grid-cols-2">
                          <div><span className="font-semibold text-slate-950">Conversation Mode:</span> {message.route.conversationMode ?? message.route.mode}</div>
                          {message.route.taskMode && <div><span className="font-semibold text-slate-950">Task Mode:</span> {message.route.taskMode}</div>}
                          <div><span className="font-semibold text-slate-950">Intent:</span> {message.route.detectedIntent}</div>
                          <div><span className="font-semibold text-slate-950">Routing:</span> {routingLabel(message.route)}</div>
                          <div><span className="font-semibold text-slate-950">Safety:</span> {message.route.safetyStatus}</div>
                          {message.sessionContext && <div><span className="font-semibold text-slate-950">Memory:</span> {message.sessionContext.scaffoldStatus}</div>}
                        </div>
                      )}
                      {message.codexHandoff && (
                        <div className="mt-3 overflow-hidden rounded-md border border-slate-300 bg-white">
                          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">Copyable Codex Handoff</span>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard?.writeText(message.codexHandoff?.markdown ?? "")}
                              className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Copy
                            </button>
                          </div>
                          <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 text-xs leading-5 text-slate-800">{message.codexHandoff.markdown}</pre>
                        </div>
                      )}
                      {message.developmentCampaign && (
                        <div className="mt-3 overflow-hidden rounded-md border border-sky-200 bg-white">
                          <div className="flex items-center justify-between border-b border-sky-100 px-3 py-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">Campaign Plan</span>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard?.writeText(message.developmentCampaign?.plan.handoffMarkdown ?? "")}
                              className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Copy Handoff
                            </button>
                          </div>
                          <div className="space-y-2 p-3 text-xs leading-5 text-slate-700">
                            <p><span className="font-semibold text-slate-950">Engine:</span> {message.developmentCampaign.engineStatus}</p>
                            <p><span className="font-semibold text-slate-950">Selected:</span> {message.developmentCampaign.plan.selectedLayer.layerId}</p>
                            <p><span className="font-semibold text-slate-950">Reason:</span> {message.developmentCampaign.plan.selectedReason}</p>
                            <p><span className="font-semibold text-slate-950">Next Layer:</span> {message.developmentCampaign.nextLayerAfterSelected ?? "Depends on selected layer completion"}</p>
                            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-800">{message.developmentCampaign.plan.handoffMarkdown}</pre>
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
                {isThinking && (
                  <div className="flex justify-start">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">AI-E is thinking...</div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-slate-200 bg-white p-4">
            <div className="mx-auto flex max-w-3xl gap-2 rounded-lg border border-slate-300 bg-white p-2 shadow-sm focus-within:border-sky-400">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder="Ask AI-E about a Unity feature, bug, design idea, playtest note, or Codex handoff..."
                className="max-h-40 min-h-12 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm leading-6 text-slate-950 outline-none placeholder:text-slate-400"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="self-end rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Send
              </button>
            </div>
            <p className="mx-auto mt-2 max-w-3xl text-xs text-slate-500">Enter sends. Shift+Enter adds a new line. Memory is local-browser storage for this device/browser only; implementation still needs explicit action.</p>
          </form>
        </section>

        <aside className="hidden w-80 flex-col gap-3 lg:flex">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">Current Mode</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">{modeSummary.conversationMode}</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-semibold text-slate-950">Conversation Mode</dt>
                <dd className="mt-1 text-slate-600">{modeSummary.conversationMode}</dd>
              </div>
              {modeSummary.taskMode && (
                <div>
                  <dt className="font-semibold text-slate-950">Task Mode</dt>
                  <dd className="mt-1 text-slate-600">{modeSummary.taskMode}</dd>
                </div>
              )}
              <div>
                <dt className="font-semibold text-slate-950">Detected Intent</dt>
                <dd className="mt-1 text-slate-600">{modeSummary.intent}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-950">Routing</dt>
                <dd className="mt-1 text-slate-600">{modeSummary.route}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-950">Safety</dt>
                <dd className="mt-1 text-slate-600">{modeSummary.safety}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-950">Suggested Next Action</dt>
                <dd className="mt-1 text-slate-600">{modeSummary.next}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-950">Scaffold Status</dt>
                <dd className="mt-1 text-slate-600">{modeSummary.memoryStatus}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">Session Context</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-semibold text-slate-950">Scope</dt>
                <dd className="mt-1 text-slate-600">{modeSummary.memoryScope}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-950">Active System</dt>
                <dd className="mt-1 text-slate-600">{modeSummary.activeSystem}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-950">Current Task</dt>
                <dd className="mt-1 text-slate-600">{modeSummary.currentTask}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-950">Latest Handoff</dt>
                <dd className="mt-1 text-slate-600">{modeSummary.latestHandoff}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600 shadow-sm">
            <p className="font-semibold text-slate-950">Truthful Scope</p>
            <p className="mt-2">This page is a real chat UI with conversational orchestration, deterministic task classification, and local-browser project/task context. It does not provide cross-browser or long-term AI memory, autonomously edit files, control Unity, run playtests, or claim implementation.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
