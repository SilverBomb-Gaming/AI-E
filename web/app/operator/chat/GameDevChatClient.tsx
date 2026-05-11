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
      return <h3 key={index} className="mt-3 text-base font-semibold text-zinc-50">{line.slice(2)}</h3>;
    }
    if (line.startsWith("## ")) {
      return <h4 key={index} className="mt-3 text-sm font-semibold text-zinc-100">{line.slice(3)}</h4>;
    }
    if (line.startsWith("- ")) {
      return <p key={index} className="ml-4 text-sm leading-6 text-zinc-300">• {line.slice(2)}</p>;
    }
    if (!line.trim()) {
      return <div key={index} className="h-2" />;
    }
    return <p key={index} className="text-sm leading-6 text-zinc-300">{line}</p>;
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
  const [executionRequestInFlight, setExecutionRequestInFlight] = useState<string | null>(null);
  const [workCycleInFlight, setWorkCycleInFlight] = useState<string | null>(null);
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
        scopedExecution: response.scopedExecution,
        workCycle: response.workCycle,
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

  async function handleExecutionApproval(messageId: string, approvalStatus: "approved" | "rejected") {
    const message = messages.find((entry) => entry.id === messageId);
    if (!message?.scopedExecution || executionRequestInFlight) {
      return;
    }

    const requestId = message.scopedExecution.request.executionRequestId;
    setExecutionRequestInFlight(requestId);
    try {
      const response = await fetch("/api/operator/approved-execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: message.scopedExecution.request,
          approval: {
            approvalStatus,
            approvalSource: "operator_chat",
            approvedBy: "local-operator",
            approvedAt: new Date().toISOString(),
            simulated: true,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Execution request failed.");
      }

      setMessages((current) => current.map((entry) => {
        if (entry.id !== messageId || !entry.scopedExecution) {
          return entry;
        }
        return {
          ...entry,
          scopedExecution: {
            ...entry.scopedExecution,
            request: {
              ...entry.scopedExecution.request,
              approvalStatus: payload.log.approvalStatus,
              workingDirectory: payload.log.workingDirectory,
              executionStatus: payload.log.executionStatus,
              stdoutSummary: payload.log.stdoutSummary,
              stderrSummary: payload.log.stderrSummary,
              exitCode: payload.log.exitCode,
              startedAt: payload.log.startedAt,
              completedAt: payload.log.completedAt,
            },
            decision: payload.decision,
            log: payload.log,
            report: payload,
          },
        };
      }));
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : "Execution request failed.";
      setMessages((current) => current.map((entry) => entry.id === messageId ? { ...entry, content: `${entry.content}\n\nExecution pipeline error: ${failureMessage}` } : entry));
    } finally {
      setExecutionRequestInFlight(null);
    }
  }

  async function handleWorkCycleApproval(messageId: string, approvalStatus: "approved" | "rejected") {
    const message = messages.find((entry) => entry.id === messageId);
    if (!message?.workCycle || workCycleInFlight) {
      return;
    }

    const cycleRequestId = message.workCycle.request.cycleRequestId;
    setWorkCycleInFlight(cycleRequestId);
    try {
      const response = await fetch("/api/operator/work-cycle-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: {
            ...message.workCycle.request,
            approvalStatus,
            cycleStatus: approvalStatus === "approved" ? "approved" : "blocked",
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Work cycle launch failed.");
      }
      setMessages((current) => current.map((entry) => entry.id === messageId && entry.workCycle ? {
        ...entry,
        workCycle: {
          request: payload,
          summaryReport: payload.summaryReport,
        },
      } : entry));
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : "Work cycle launch failed.";
      setMessages((current) => current.map((entry) => entry.id === messageId ? { ...entry, content: `${entry.content}\n\nWork cycle launcher error: ${failureMessage}` } : entry));
    } finally {
      setWorkCycleInFlight(null);
    }
  }

  return (
    <main data-theme="dark" style={{ colorScheme: "dark" }} className="min-h-screen bg-[#070b12] text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl gap-4 px-4 py-5 lg:px-6">
        <section className="flex min-h-[calc(100vh-2.5rem)] flex-1 flex-col overflow-hidden rounded-lg border border-white/10 bg-[#0d1420] shadow-2xl shadow-black/30">
          <header className="border-b border-white/10 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">AI-E Game Dev Chat</p>
            <div className="mt-1 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Talk naturally. Build safely.</h1>
                <p className="mt-1 max-w-2xl text-sm text-zinc-300">AI-E understands conversational state first, keeps session-scoped context in memory, then routes game-dev tasks Unity-first without pretending it edited files.</p>
              </div>
              <span className="w-fit rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">{scaffoldStatus}</span>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-5">
            {messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-3xl flex-col justify-center py-16">
                <div className="rounded-lg border border-white/10 bg-[#111827] p-5">
                  <h2 className="text-lg font-semibold text-zinc-50">What are we making today?</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">Say hello, ask what AI-E can do, continue a thread, refine the last idea, use the last handoff, report a failed attempt, or ask for tuning, bugs, design ideas, Unity planning, or a Codex handoff.</p>
                  <div className="mt-4 grid gap-2 md:grid-cols-2">
                    {starterPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => submitMessage(prompt)}
                        className="rounded-md border border-white/10 bg-[#0b1220] px-3 py-3 text-left text-sm text-zinc-200 transition hover:border-cyan-400/60 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
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
                    <div className={`max-w-[88%] rounded-lg px-4 py-3 ${message.role === "user" ? "bg-cyan-700 text-white shadow-lg shadow-cyan-950/30" : "border border-white/10 bg-[#111827] text-zinc-100"}`}>
                      <div className={message.role === "user" ? "whitespace-pre-wrap text-sm leading-6 text-white" : "space-y-0"}>
                        {message.role === "user" ? message.content : renderMarkdownLite(message.content)}
                      </div>
                      {message.route && (
                        <div className="mt-3 grid gap-2 rounded-md border border-white/10 bg-[#0b1220] p-3 text-xs text-zinc-300 md:grid-cols-2">
                          <div><span className="font-semibold text-zinc-100">Conversation Mode:</span> {message.route.conversationMode ?? message.route.mode}</div>
                          {message.route.taskMode && <div><span className="font-semibold text-zinc-100">Task Mode:</span> {message.route.taskMode}</div>}
                          <div><span className="font-semibold text-zinc-100">Intent:</span> {message.route.detectedIntent}</div>
                          <div><span className="font-semibold text-zinc-100">Routing:</span> {routingLabel(message.route)}</div>
                          <div><span className="font-semibold text-zinc-100">Safety:</span> {message.route.safetyStatus}</div>
                          {message.sessionContext && <div><span className="font-semibold text-zinc-100">Memory:</span> {message.sessionContext.scaffoldStatus}</div>}
                        </div>
                      )}
                      {message.codexHandoff && (
                        <div className="mt-3 overflow-hidden rounded-md border border-white/10 bg-[#0b1220]">
                          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">Copyable Codex Handoff</span>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard?.writeText(message.codexHandoff?.markdown ?? "")}
                              className="rounded-md border border-white/15 px-2 py-1 text-xs font-semibold text-zinc-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                            >
                              Copy
                            </button>
                          </div>
                          <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 text-xs leading-5 text-zinc-200">{message.codexHandoff.markdown}</pre>
                        </div>
                      )}
                      {message.developmentCampaign && (
                        <div className="mt-3 overflow-hidden rounded-md border border-cyan-500/30 bg-[#0b1220]">
                          <div className="flex items-center justify-between border-b border-cyan-500/20 px-3 py-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-300">Campaign Plan</span>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard?.writeText(message.developmentCampaign?.plan.handoffMarkdown ?? "")}
                              className="rounded-md border border-white/15 px-2 py-1 text-xs font-semibold text-zinc-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                            >
                              Copy Handoff
                            </button>
                          </div>
                          <div className="space-y-2 p-3 text-xs leading-5 text-zinc-300">
                            <p><span className="font-semibold text-zinc-100">Engine:</span> {message.developmentCampaign.engineStatus}</p>
                            <p><span className="font-semibold text-zinc-100">Selected:</span> {message.developmentCampaign.plan.selectedLayer.layerId}</p>
                            <p><span className="font-semibold text-zinc-100">Reason:</span> {message.developmentCampaign.plan.selectedReason}</p>
                            <p><span className="font-semibold text-zinc-100">Next Layer:</span> {message.developmentCampaign.nextLayerAfterSelected ?? "Depends on selected layer completion"}</p>
                            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-[#070b12] p-3 text-xs leading-5 text-zinc-200">{message.developmentCampaign.plan.handoffMarkdown}</pre>
                          </div>
                        </div>
                      )}
                      {message.scopedExecution && (
                        <div className="mt-3 overflow-hidden rounded-md border border-amber-400/30 bg-[#0b1220]">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/20 px-3 py-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">Scoped Execution Request</span>
                            {(!message.scopedExecution.report || message.scopedExecution.report.finalState === "failed" || message.scopedExecution.report.finalState === "timed_out" || message.scopedExecution.report.finalState === "adapter_disabled") && (
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={executionRequestInFlight === message.scopedExecution.request.executionRequestId}
                                  onClick={() => handleExecutionApproval(message.id, "approved")}
                                  className="rounded-md border border-emerald-300/40 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                                >
                                  {message.scopedExecution.report ? "Retry Approved" : "Approve & Execute"}
                                </button>
                                {!message.scopedExecution.report && (
                                  <button
                                    type="button"
                                    disabled={executionRequestInFlight === message.scopedExecution.request.executionRequestId}
                                    onClick={() => handleExecutionApproval(message.id, "rejected")}
                                    className="rounded-md border border-rose-300/40 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-300"
                                  >
                                    Reject
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="grid gap-2 p-3 text-xs leading-5 text-zinc-300 md:grid-cols-2">
                            <p><span className="font-semibold text-zinc-100">Request:</span> {message.scopedExecution.request.executionRequestId}</p>
                            <p><span className="font-semibold text-zinc-100">Status:</span> {message.scopedExecution.log.executionStatus}</p>
                            <p><span className="font-semibold text-zinc-100">Command:</span> {message.scopedExecution.request.command}</p>
                            <p><span className="font-semibold text-zinc-100">Approval:</span> {message.scopedExecution.request.approvalStatus}</p>
                            <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Truthfulness:</span> {message.scopedExecution.log.truthfulnessLabel}</p>
                            {message.scopedExecution.decision.blockedReason && <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Blocked:</span> {message.scopedExecution.decision.blockedReason}</p>}
                            {message.scopedExecution.report && (
                              <>
                                <p><span className="font-semibold text-zinc-100">Final State:</span> {message.scopedExecution.report.finalState}</p>
                                <p><span className="font-semibold text-zinc-100">Runtime:</span> {message.scopedExecution.report.runtimeEnabled ? "enabled" : "disabled"}</p>
                                <p><span className="font-semibold text-zinc-100">Exit Code:</span> {message.scopedExecution.report.exitCode ?? "none"}</p>
                                <p><span className="font-semibold text-zinc-100">Elapsed:</span> {message.scopedExecution.report.elapsedMs}ms</p>
                                <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Approval Source:</span> {message.scopedExecution.report.approvalSourceLabel}</p>
                                <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Next:</span> {message.scopedExecution.report.recommendedNextAction}</p>
                                <pre className="md:col-span-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-[#070b12] p-2 text-[11px] leading-5 text-zinc-200">{message.scopedExecution.report.lifecycle.map((event) => `${event.timestamp} ${event.state}: ${event.summary}`).join("\n")}</pre>
                                {(message.scopedExecution.report.stdout || message.scopedExecution.report.stderr) && <pre className="md:col-span-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-[#070b12] p-2 text-[11px] leading-5 text-zinc-200">{[`stdout:\n${message.scopedExecution.report.stdout || "(empty)"}`, `stderr:\n${message.scopedExecution.report.stderr || "(empty)"}`].join("\n\n")}</pre>}
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      {message.workCycle && (
                        <div className="mt-3 overflow-hidden rounded-md border border-violet-400/30 bg-[#0b1220]">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-400/20 px-3 py-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">Operator Work Cycle</span>
                            {!message.workCycle.summaryReport && (
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={workCycleInFlight === message.workCycle.request.cycleRequestId}
                                  onClick={() => handleWorkCycleApproval(message.id, "approved")}
                                  className="rounded-md border border-emerald-300/40 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                                >
                                  Approve Cycle
                                </button>
                                <button
                                  type="button"
                                  disabled={workCycleInFlight === message.workCycle.request.cycleRequestId}
                                  onClick={() => handleWorkCycleApproval(message.id, "rejected")}
                                  className="rounded-md border border-rose-300/40 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-300"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="grid gap-2 p-3 text-xs leading-5 text-zinc-300 md:grid-cols-2">
                            <p><span className="font-semibold text-zinc-100">Cycle:</span> {message.workCycle.request.cycleRequestId}</p>
                            <p><span className="font-semibold text-zinc-100">Status:</span> {message.workCycle.summaryReport?.cycleStatus ?? message.workCycle.request.cycleStatus}</p>
                            <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Intent:</span> {message.workCycle.request.cycleIntent}</p>
                            <p><span className="font-semibold text-zinc-100">Retry Limit:</span> {message.workCycle.request.retryLimit}</p>
                            <p><span className="font-semibold text-zinc-100">Targets:</span> {message.workCycle.request.targetFiles.length}</p>
                            {message.workCycle.summaryReport && (
                              <>
                                <p><span className="font-semibold text-zinc-100">Independent Status:</span> {message.workCycle.summaryReport.independentExclusiveExecutionStatus}</p>
                                <p><span className="font-semibold text-zinc-100">Truthfulness:</span> {message.workCycle.summaryReport.truthfulnessLabel}</p>
                                <p><span className="font-semibold text-zinc-100">Stages:</span> {message.workCycle.summaryReport.operationalStageCount}</p>
                                <p><span className="font-semibold text-zinc-100">Checkpoints:</span> {message.workCycle.summaryReport.checkpointCount}</p>
                                <p><span className="font-semibold text-zinc-100">Retries:</span> {message.workCycle.summaryReport.retryCount}</p>
                                <p><span className="font-semibold text-zinc-100">Rollbacks:</span> {message.workCycle.summaryReport.rollbackCount}</p>
                                <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Validation:</span> {message.workCycle.summaryReport.validationState}</p>
                                <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Summary:</span> {message.workCycle.summaryReport.summary}</p>
                                <pre className="md:col-span-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-[#070b12] p-2 text-[11px] leading-5 text-zinc-200">{message.workCycle.summaryReport.completedStages.join(" -> ") || "No completed stages reported."}</pre>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
                {isThinking && (
                  <div className="flex justify-start">
                    <div className="rounded-lg border border-white/10 bg-[#111827] px-4 py-3 text-sm text-zinc-300">AI-E is thinking...</div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-white/10 bg-[#0d1420] p-4">
            <div className="mx-auto flex max-w-3xl gap-2 rounded-lg border border-white/10 bg-[#070b12] p-2 shadow-sm shadow-black/20 focus-within:border-cyan-400">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder="Ask AI-E about a Unity feature, bug, design idea, playtest note, or Codex handoff..."
                className="max-h-40 min-h-12 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-500"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="self-end rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
              >
                Send
              </button>
            </div>
            <p className="mx-auto mt-2 max-w-3xl text-xs text-zinc-400">Enter sends. Shift+Enter adds a new line. Memory is local-browser storage for this device/browser only; implementation still needs explicit action.</p>
          </form>
        </section>

        <aside className="hidden w-80 flex-col gap-3 lg:flex">
          <div className="rounded-lg border border-white/10 bg-[#0d1420] p-4 shadow-2xl shadow-black/20">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">Current Mode</p>
            <h2 className="mt-2 text-lg font-semibold text-zinc-50">{modeSummary.conversationMode}</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-semibold text-zinc-100">Conversation Mode</dt>
                <dd className="mt-1 text-zinc-300">{modeSummary.conversationMode}</dd>
              </div>
              {modeSummary.taskMode && (
                <div>
                  <dt className="font-semibold text-zinc-100">Task Mode</dt>
                  <dd className="mt-1 text-zinc-300">{modeSummary.taskMode}</dd>
                </div>
              )}
              <div>
                <dt className="font-semibold text-zinc-100">Detected Intent</dt>
                <dd className="mt-1 text-zinc-300">{modeSummary.intent}</dd>
              </div>
              <div>
                <dt className="font-semibold text-zinc-100">Routing</dt>
                <dd className="mt-1 text-zinc-300">{modeSummary.route}</dd>
              </div>
              <div>
                <dt className="font-semibold text-zinc-100">Safety</dt>
                <dd className="mt-1 text-zinc-300">{modeSummary.safety}</dd>
              </div>
              <div>
                <dt className="font-semibold text-zinc-100">Suggested Next Action</dt>
                <dd className="mt-1 text-zinc-300">{modeSummary.next}</dd>
              </div>
              <div>
                <dt className="font-semibold text-zinc-100">Scaffold Status</dt>
                <dd className="mt-1 text-amber-200">{modeSummary.memoryStatus}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-lg border border-white/10 bg-[#0d1420] p-4 shadow-2xl shadow-black/20">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">Session Context</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-semibold text-zinc-100">Scope</dt>
                <dd className="mt-1 text-zinc-300">{modeSummary.memoryScope}</dd>
              </div>
              <div>
                <dt className="font-semibold text-zinc-100">Active System</dt>
                <dd className="mt-1 text-zinc-300">{modeSummary.activeSystem}</dd>
              </div>
              <div>
                <dt className="font-semibold text-zinc-100">Current Task</dt>
                <dd className="mt-1 text-zinc-300">{modeSummary.currentTask}</dd>
              </div>
              <div>
                <dt className="font-semibold text-zinc-100">Latest Handoff</dt>
                <dd className="mt-1 text-zinc-300">{modeSummary.latestHandoff}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100 shadow-2xl shadow-black/20">
            <p className="font-semibold text-amber-50">Truthful Scope</p>
            <p className="mt-2">This page is a real chat UI with conversational orchestration, deterministic task classification, and local-browser project/task context. It does not provide cross-browser or long-term AI memory, autonomously edit files, control Unity, run playtests, or claim implementation.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
