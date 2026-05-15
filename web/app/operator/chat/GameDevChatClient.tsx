"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { loadGameDevSessionContext, saveGameDevSessionContext } from "@/lib/aie/gameDevChat/gameDevDurableSessionStore";
import { createInitialGameDevSessionContext } from "@/lib/aie/gameDevChat/gameDevSessionContext";
import { planGameDevChatResponse } from "@/lib/aie/gameDevChat/gameDevResponsePlanner";
import type { GameDevChatMessage, GameDevSessionContext } from "./gameDevChatTypes";

const starterPrompts = [
  "I want my player jump to feel less floaty.",
  "Help me add a basic enemy patrol system.",
  "Fix the failing tests.",
  "Inspect the interaction system.",
  "I have an idea for a game but I don't know how to explain it.",
  "Make me an AI-E supervised execution brief for adding a basic collectible system in Unity.",
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
      return <p key={index} className="ml-4 text-sm leading-6 text-zinc-300">- {line.slice(2)}</p>;
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

function statusPillClass(status: string): string {
  if (["completed", "validated", "supervised_real"].includes(status)) {
    return "border-emerald-300/40 bg-emerald-400/10 text-emerald-100";
  }
  if (["blocked", "failed", "validation_failed", "rejected"].includes(status)) {
    return "border-rose-300/40 bg-rose-400/10 text-rose-100";
  }
  if (["running", "executing", "mutating", "validating", "checkpointing"].includes(status)) {
    return "border-cyan-300/40 bg-cyan-400/10 text-cyan-100";
  }
  return "border-white/15 bg-white/5 text-zinc-200";
}

export function GameDevChatClient() {
  const [messages, setMessages] = useState<GameDevChatMessage[]>([]);
  const [sessionContext, setSessionContext] = useState<GameDevSessionContext>(() => createInitialGameDevSessionContext());
  const [draft, setDraft] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [executionRequestInFlight, setExecutionRequestInFlight] = useState<string | null>(null);
  const [workCycleInFlight, setWorkCycleInFlight] = useState<string | null>(null);
  const [durableContinuityInFlight, setDurableContinuityInFlight] = useState<string | null>(null);
  const [meaningfulLongRunInFlight, setMeaningfulLongRunInFlight] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const latestWorkflow = [...messages].reverse().find((message) => message.workCycle)?.workCycle;
  const latestRoute = latestAssistant?.route;
  const scaffoldStatus = latestAssistant ? "SESSION_CONTEXT_AND_CONVERSATION_MEMORY_PHASE1" : "Ready for session-scoped chat";

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
    latestHandoff: sessionContext.latestCodexHandoffTopic ?? "No supervised execution brief in this session yet",
    activeCycle: latestWorkflow?.summaryReport?.activeCycleDisplay.cycleRequestId ?? latestWorkflow?.request.cycleRequestId ?? "No active repo workflow yet",
    activeStage: latestWorkflow?.summaryReport?.activeCycleDisplay.currentStage ?? latestWorkflow?.request.cycleStatus ?? "idle",
    activeRuntime: latestWorkflow?.summaryReport?.activeCycleDisplay.elapsedRuntimeMs ?? 0,
    activeIndependentStatus: latestWorkflow?.summaryReport?.independentExclusiveExecutionStatus ?? "not_real",
  }), [latestRoute, sessionContext, latestWorkflow]);

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
        reasoning: response.reasoning,
        codexHandoff: response.codexHandoff,
        developmentCampaign: response.developmentCampaign,
        scopedExecution: response.scopedExecution,
        workCycle: response.workCycle,
        durableContinuity: response.durableContinuity,
        meaningfulLongRun: response.meaningfulLongRun,
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

  async function handleWorkCycleRestore(messageId: string) {
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
        body: JSON.stringify({ restore: true, cycleRequestId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Checkpoint restore failed.");
      }
      setMessages((current) => current.map((entry) => entry.id === messageId && entry.workCycle ? {
        ...entry,
        workCycle: {
          ...entry.workCycle,
          summaryReport: payload.summaryReport ?? entry.workCycle.summaryReport,
        },
      } : entry));
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : "Checkpoint restore failed.";
      setMessages((current) => current.map((entry) => entry.id === messageId ? { ...entry, content: `${entry.content}\n\nCheckpoint restore error: ${failureMessage}` } : entry));
    } finally {
      setWorkCycleInFlight(null);
    }
  }

  function handleWorkCycleLocalAction(messageId: string, action: "cancel" | "stop" | "retry") {
    const label = action === "cancel" ? "Operator canceled the prepared workflow before execution." : action === "stop" ? "Stop requested. Phase 1 cycles are short server requests, so no unattended background run was left active." : "Retry requested. Use Approve Cycle again to submit another supervised request.";
    setMessages((current) => current.map((entry) => entry.id === messageId ? { ...entry, content: `${entry.content}\n\n${label}` } : entry));
  }

  async function handleDurableContinuityRestore(messageId: string) {
    const message = messages.find((entry) => entry.id === messageId);
    if (!message?.durableContinuity || durableContinuityInFlight) {
      return;
    }

    const requestAction = message.durableContinuity.request.action;
    setDurableContinuityInFlight(requestAction);
    try {
      const response = await fetch("/api/operator/durable-runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message.durableContinuity.request),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Durable runtime restore failed.");
      }
      setMessages((current) => current.map((entry) => entry.id === messageId && entry.durableContinuity ? {
        ...entry,
        durableContinuity: {
          ...entry.durableContinuity,
          report: payload.report,
        },
      } : entry));
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : "Durable runtime restore failed.";
      setMessages((current) => current.map((entry) => entry.id === messageId ? { ...entry, content: `${entry.content}\n\nDurable runtime error: ${failureMessage}` } : entry));
    } finally {
      setDurableContinuityInFlight(null);
    }
  }

  async function handleMeaningfulLongRunStart(messageId: string) {
    const message = messages.find((entry) => entry.id === messageId);
    if (!message?.meaningfulLongRun || meaningfulLongRunInFlight) {
      return;
    }

    const sessionId = message.meaningfulLongRun.request.sessionId;
    setMeaningfulLongRunInFlight(sessionId);
    try {
      const response = await fetch("/api/operator/meaningful-long-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...message.meaningfulLongRun.request, approvalStatus: "approved" }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Meaningful long-run start failed.");
      }
      setMessages((current) => current.map((entry) => entry.id === messageId && entry.meaningfulLongRun ? {
        ...entry,
        meaningfulLongRun: {
          ...entry.meaningfulLongRun,
          report: payload.report,
        },
      } : entry));
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : "Meaningful long-run start failed.";
      setMessages((current) => current.map((entry) => entry.id === messageId ? { ...entry, content: `${entry.content}\n\nMeaningful long-run error: ${failureMessage}` } : entry));
    } finally {
      setMeaningfulLongRunInFlight(null);
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
                  <p className="mt-2 text-sm leading-6 text-zinc-300">Say hello, ask what AI-E can do, continue a thread, refine the last idea, reuse the latest brief, report a failed attempt, or ask for tuning, bugs, design ideas, Unity planning, or a supervised workflow brief.</p>
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
                      {message.reasoning && (
                        <details className="mt-3 overflow-hidden rounded-md border border-cyan-400/25 bg-[#08111d]">
                          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Reasoning Visibility</summary>
                          {message.reasoning.runtimeIntrospection ? (
                            <div className="grid gap-2 border-t border-cyan-400/15 p-3 text-xs leading-5 text-zinc-300 md:grid-cols-2">
                              <p><span className="font-semibold text-zinc-100">Runtime Introspection:</span> capability status query</p>
                              <p><span className="font-semibold text-zinc-100">Query:</span> {message.reasoning.runtimeIntrospection.label}</p>
                              <p><span className="font-semibold text-zinc-100">Confidence:</span> {message.reasoning.confidence}</p>
                              <p><span className="font-semibold text-zinc-100">Runtime:</span> {message.reasoning.runtimeAwareness.runtimeAvailability}</p>
                              <p><span className="font-semibold text-zinc-100">Owner:</span> {message.reasoning.executionOwnership.ownerLabel}</p>
                              <p><span className="font-semibold text-zinc-100">Ownership:</span> {message.reasoning.executionOwnership.kind}</p>
                              <p><span className="font-semibold text-zinc-100">Workflow:</span> {message.reasoning.executionOwnership.workflowType}</p>
                              <p><span className="font-semibold text-zinc-100">Approval:</span> {message.reasoning.executionOwnership.approvalRequirement}</p>
                              <p><span className="font-semibold text-zinc-100">Execution Route:</span> {message.reasoning.executionRoute.routeType}</p>
                              <p><span className="font-semibold text-zinc-100">Approval Status:</span> {message.reasoning.executionRoute.contract.approvalStatus}</p>
                              <p><span className="font-semibold text-zinc-100">Mutation Permission:</span> {message.reasoning.executionRoute.contract.mutationAllowed ? "allowed" : "not allowed"}</p>
                              <p><span className="font-semibold text-zinc-100">Validation Requirement:</span> {message.reasoning.executionRoute.contract.validationRequired ? "required" : "not required"}</p>
                              <p><span className="font-semibold text-zinc-100">Rollback Availability:</span> {message.reasoning.executionRoute.contract.rollbackAvailable ? "available" : "not available"}</p>
                              <p><span className="font-semibold text-zinc-100">Runtime Ownership Level:</span> {message.reasoning.executionRoute.contract.runtimeOwnershipLevel}</p>
                              <p><span className="font-semibold text-zinc-100">Lifecycle Stage:</span> {message.reasoning.runtimeLifecycle.currentStage}</p>
                              <p><span className="font-semibold text-zinc-100">Lifecycle Status:</span> {message.reasoning.runtimeLifecycle.lifecycleStatus}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Next Gate:</span> {message.reasoning.runtimeLifecycle.nextGate}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Persistence Plan:</span> {message.reasoning.runtimeLifecycle.persistencePlan}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Mutation Scope:</span> {message.reasoning.executionOwnership.mutationScope}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Validation Scope:</span> {message.reasoning.executionOwnership.validationScope}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Dependency:</span> {message.reasoning.executionOwnership.dependencyExplanation}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Why:</span> {message.reasoning.routeRationale}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Limitation:</span> {message.reasoning.limitationExplanation}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Next:</span> {message.reasoning.nextUsefulStep}</p>
                              <pre className="md:col-span-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-[#070b12] p-2 text-[11px] leading-5 text-zinc-200">{[
                                "real:",
                                ...message.reasoning.runtimeIntrospection.real.map((entry) => `- ${entry}`),
                                "bounded/supervised:",
                                ...message.reasoning.runtimeIntrospection.bounded.map((entry) => `- ${entry}`),
                                "external:",
                                ...message.reasoning.runtimeIntrospection.external.map((entry) => `- ${entry}`),
                                "blocked:",
                                ...message.reasoning.runtimeIntrospection.blocked.map((entry) => `- ${entry}`),
                              ].join("\n")}</pre>
                            </div>
                          ) : (
                            <div className="grid gap-2 border-t border-cyan-400/15 p-3 text-xs leading-5 text-zinc-300 md:grid-cols-2">
                              <p><span className="font-semibold text-zinc-100">Inferred Intent:</span> {message.reasoning.inferredIntent}</p>
                              <p><span className="font-semibold text-zinc-100">Confidence:</span> {message.reasoning.confidence}</p>
                              <p><span className="font-semibold text-zinc-100">Route:</span> {message.reasoning.selectedCapabilityRoute}</p>
                              <p><span className="font-semibold text-zinc-100">Runtime:</span> {message.reasoning.runtimeAwareness.runtimeAvailability}</p>
                              <p><span className="font-semibold text-zinc-100">Owner:</span> {message.reasoning.executionOwnership.ownerLabel}</p>
                              <p><span className="font-semibold text-zinc-100">Ownership:</span> {message.reasoning.executionOwnership.kind}</p>
                              <p><span className="font-semibold text-zinc-100">Workflow:</span> {message.reasoning.executionOwnership.workflowType}</p>
                              <p><span className="font-semibold text-zinc-100">Approval:</span> {message.reasoning.executionOwnership.approvalRequirement}</p>
                              <p><span className="font-semibold text-zinc-100">Execution Route:</span> {message.reasoning.executionRoute.routeType}</p>
                              <p><span className="font-semibold text-zinc-100">Approval Status:</span> {message.reasoning.executionRoute.contract.approvalStatus}</p>
                              <p><span className="font-semibold text-zinc-100">Mutation Permission:</span> {message.reasoning.executionRoute.contract.mutationAllowed ? "allowed" : "not allowed"}</p>
                              <p><span className="font-semibold text-zinc-100">Validation Requirement:</span> {message.reasoning.executionRoute.contract.validationRequired ? "required" : "not required"}</p>
                              <p><span className="font-semibold text-zinc-100">Rollback Availability:</span> {message.reasoning.executionRoute.contract.rollbackAvailable ? "available" : "not available"}</p>
                              <p><span className="font-semibold text-zinc-100">Runtime Ownership Level:</span> {message.reasoning.executionRoute.contract.runtimeOwnershipLevel}</p>
                              <p><span className="font-semibold text-zinc-100">Lifecycle Stage:</span> {message.reasoning.runtimeLifecycle.currentStage}</p>
                              <p><span className="font-semibold text-zinc-100">Lifecycle Status:</span> {message.reasoning.runtimeLifecycle.lifecycleStatus}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Next Gate:</span> {message.reasoning.runtimeLifecycle.nextGate}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Persistence Plan:</span> {message.reasoning.runtimeLifecycle.persistencePlan}</p>
                              {message.reasoning.inferredFeedbackCategory && <p><span className="font-semibold text-zinc-100">Feedback Category:</span> {message.reasoning.inferredFeedbackCategory}</p>}
                              {message.reasoning.categoryMatchKind && <p><span className="font-semibold text-zinc-100">Match:</span> {message.reasoning.categoryMatchKind}</p>}
                              {message.reasoning.matchedPhraseFamily && <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Phrase Family:</span> {message.reasoning.matchedPhraseFamily}</p>}
                              <p><span className="font-semibold text-zinc-100">Strategy:</span> {message.reasoning.selectedResponseStrategy}</p>
                              {message.reasoning.fallbackReason && <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Fallback:</span> {message.reasoning.fallbackReason}</p>}
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Why:</span> {message.reasoning.routeRationale}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Mutation Scope:</span> {message.reasoning.executionOwnership.mutationScope}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Validation Scope:</span> {message.reasoning.executionOwnership.validationScope}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Dependency:</span> {message.reasoning.executionOwnership.dependencyExplanation}</p>
                              {message.reasoning.ambiguity.length > 0 && <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Ambiguity:</span> {message.reasoning.ambiguity.join(" ")}</p>}
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Limitation:</span> {message.reasoning.limitationExplanation}</p>
                              <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Next:</span> {message.reasoning.nextUsefulStep}</p>
                              <pre className="md:col-span-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-[#070b12] p-2 text-[11px] leading-5 text-zinc-200">{message.reasoning.decompositionDimensions.map((entry) => `- ${entry}`).join("\n")}</pre>
                            </div>
                          )}
                        </details>
                      )}
                      {message.codexHandoff && (
                        <div className="mt-3 overflow-hidden rounded-md border border-white/10 bg-[#0b1220]">
                          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">Copyable AI-E Supervised Execution Brief</span>
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
                            <div className="flex flex-wrap gap-2">
                              {!message.workCycle.summaryReport && (
                                <>
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
                                <button
                                  type="button"
                                  disabled={workCycleInFlight === message.workCycle.request.cycleRequestId}
                                  onClick={() => handleWorkCycleLocalAction(message.id, "cancel")}
                                  className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
                                >
                                  Cancel
                                </button>
                                </>
                              )}
                              {message.workCycle.summaryReport && (
                                <>
                                  <button
                                    type="button"
                                    disabled={workCycleInFlight === message.workCycle.request.cycleRequestId}
                                    onClick={() => handleWorkCycleRestore(message.id)}
                                    className="rounded-md border border-teal-300/40 bg-teal-500/10 px-2 py-1 text-xs font-semibold text-teal-100 hover:bg-teal-500/20 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-300"
                                  >
                                    Restore Checkpoint
                                  </button>
                                  <button
                                    type="button"
                                    disabled={workCycleInFlight === message.workCycle.request.cycleRequestId}
                                    onClick={() => handleWorkCycleApproval(message.id, "approved")}
                                    className="rounded-md border border-amber-300/40 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
                                  >
                                    Request Retry
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleWorkCycleLocalAction(message.id, "stop")}
                                    className="rounded-md border border-rose-300/40 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-300"
                                  >
                                    Stop Active Run
                                  </button>
                                </>
                              )}
                            </div>
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
                                <div className="md:col-span-2 rounded-md border border-white/10 bg-[#070b12] p-3">
                                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">Visible Lifecycle</p>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {message.workCycle.summaryReport.visibleLifecycle.map((event, index) => (
                                      <span key={`${event.status}-${index}`} title={event.summary} className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusPillClass(event.status)}`}>{event.status}</span>
                                    ))}
                                  </div>
                                </div>
                                <div className="md:col-span-2 grid gap-2 md:grid-cols-2">
                                  <div className="rounded-md border border-white/10 bg-[#070b12] p-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Checkpoint Feed</p>
                                    <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-zinc-200">{message.workCycle.summaryReport.checkpointFeed.map((checkpoint) => `${checkpoint.checkpointId}: ${checkpoint.completedStages.join(" -> ")} | ${checkpoint.validationOutcomeSummary}`).join("\n") || "No checkpoints reported."}</pre>
                                  </div>
                                  <div className="rounded-md border border-white/10 bg-[#070b12] p-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-200">Mutation Summary</p>
                                    <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-zinc-200">{message.workCycle.summaryReport.mutationSummaryFeed.join("\n") || "No mutation summary reported."}</pre>
                                  </div>
                                  <div className="rounded-md border border-white/10 bg-[#070b12] p-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">Validation Feed</p>
                                    <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-zinc-200">{message.workCycle.summaryReport.validationFeed.map((result) => `${result.command}: ${result.status} exit=${result.exitCode ?? "none"} ${result.truthfulnessLabel}`).join("\n") || "No real validation command reported."}</pre>
                                  </div>
                                  <div className="rounded-md border border-white/10 bg-[#070b12] p-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-rose-200">Rollback / Retry Feed</p>
                                    <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-zinc-200">{[...message.workCycle.summaryReport.rollbackFeed.map((entry) => `rollback: ${entry}`), ...message.workCycle.summaryReport.retryFeed.map((entry) => `retry: ${entry}`)].join("\n") || "No rollback or retry executed."}</pre>
                                  </div>
                                </div>
                                <div className="md:col-span-2 rounded-md border border-white/10 bg-[#070b12] p-3">
                                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-200">Diff Preview And Changed Files</p>
                                  <p className="mt-2 text-[11px] text-zinc-300">Changed files: {message.workCycle.summaryReport.changedFiles.join(", ") || "none"}</p>
                                  <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-zinc-200">{message.workCycle.summaryReport.diffPreviews.map((entry) => entry.diffPreview).join("\n\n") || "No diff preview reported."}</pre>
                                </div>
                                <div className="md:col-span-2 rounded-md border border-white/10 bg-[#070b12] p-3">
                                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-200">Runtime Transparency</p>
                                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                                    <p>Runtime executed: {String(message.workCycle.summaryReport.runtimeTransparency.runtimeActuallyExecuted)}</p>
                                    <p>Mutation occurred: {String(message.workCycle.summaryReport.runtimeTransparency.mutationTrulyOccurred)}</p>
                                    <p>Validation executed: {String(message.workCycle.summaryReport.runtimeTransparency.validationTrulyExecuted)}</p>
                                    <p>Simulated runtime: {String(message.workCycle.summaryReport.runtimeTransparency.simulatedRuntime)}</p>
                                    <p className="md:col-span-2">Blocked: {message.workCycle.summaryReport.runtimeTransparency.blockedCapabilities.join(", ")}</p>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      {message.durableContinuity && (
                        <div className="mt-3 overflow-hidden rounded-md border border-teal-400/30 bg-[#0b1220]">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-400/20 px-3 py-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-200">Durable Runtime Continuity</span>
                            {!message.durableContinuity.report && (
                              <button
                                type="button"
                                disabled={durableContinuityInFlight === message.durableContinuity.request.action}
                                onClick={() => handleDurableContinuityRestore(message.id)}
                                className="rounded-md border border-emerald-300/40 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                              >
                                Restore State
                              </button>
                            )}
                          </div>
                          <div className="grid gap-2 p-3 text-xs leading-5 text-zinc-300 md:grid-cols-2">
                            <p><span className="font-semibold text-zinc-100">Action:</span> {message.durableContinuity.request.action}</p>
                            <p><span className="font-semibold text-zinc-100">Project:</span> {message.durableContinuity.request.projectId}</p>
                            <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Persistence:</span> local JSON file-backed runtime state only</p>
                            {message.durableContinuity.report && (
                              <>
                                <p><span className="font-semibold text-zinc-100">Durable Restore:</span> {String(message.durableContinuity.report.durableRestorationOccurred)}</p>
                                <p><span className="font-semibold text-zinc-100">Restart Continuity:</span> {String(message.durableContinuity.report.runtimeContinuitySurvivedRestart)}</p>
                                <p><span className="font-semibold text-zinc-100">Cycles:</span> {message.durableContinuity.report.totalCycleCount}</p>
                                <p><span className="font-semibold text-zinc-100">Resumed:</span> {message.durableContinuity.report.cycleCountResumed}</p>
                                <p><span className="font-semibold text-zinc-100">Checkpoints:</span> {message.durableContinuity.report.checkpointCountRestored}</p>
                                <p><span className="font-semibold text-zinc-100">Safely Resumable:</span> {String(message.durableContinuity.report.safelyResumable)}</p>
                                <p><span className="font-semibold text-zinc-100">Independent Status:</span> {message.durableContinuity.report.independentExclusiveExecutionStatus}</p>
                                <p><span className="font-semibold text-zinc-100">Truthfulness:</span> {message.durableContinuity.report.runtimeTruthfulnessLabel}</p>
                                {message.durableContinuity.report.blockedReason && <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Blocked:</span> {message.durableContinuity.report.blockedReason}</p>}
                                <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Summary:</span> {message.durableContinuity.report.summary}</p>
                                <pre className="md:col-span-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-[#070b12] p-2 text-[11px] leading-5 text-zinc-200">{message.durableContinuity.report.persistenceLimitations.join("\n")}</pre>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      {message.meaningfulLongRun && (
                        <div className="mt-3 overflow-hidden rounded-md border border-sky-400/30 bg-[#0b1220]">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-400/20 px-3 py-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-200">Meaningful Long-Run Supervised Operation</span>
                            {!message.meaningfulLongRun.report && (
                              <button
                                type="button"
                                disabled={meaningfulLongRunInFlight === message.meaningfulLongRun.request.sessionId}
                                onClick={() => handleMeaningfulLongRunStart(message.id)}
                                className="rounded-md border border-emerald-300/40 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                              >
                                Approve & Start
                              </button>
                            )}
                          </div>
                          <div className="grid gap-2 p-3 text-xs leading-5 text-zinc-300 md:grid-cols-2">
                            <p><span className="font-semibold text-zinc-100">Session:</span> {message.meaningfulLongRun.request.sessionId}</p>
                            <p><span className="font-semibold text-zinc-100">Mode:</span> {message.meaningfulLongRun.request.mode}</p>
                            <p><span className="font-semibold text-zinc-100">Target:</span> {message.meaningfulLongRun.request.targetRuntimeMs}ms</p>
                            <p><span className="font-semibold text-zinc-100">Checkpoint Interval:</span> {message.meaningfulLongRun.request.checkpointIntervalMs}ms</p>
                            {message.meaningfulLongRun.report && (
                              <>
                                <p><span className="font-semibold text-zinc-100">Actual Runtime:</span> {message.meaningfulLongRun.report.actualRuntimeMs}ms</p>
                                <p><span className="font-semibold text-zinc-100">Target Met:</span> {String(message.meaningfulLongRun.report.targetRuntimeMet)}</p>
                                <p><span className="font-semibold text-zinc-100">Cycles:</span> {message.meaningfulLongRun.report.cycleCount}</p>
                                <p><span className="font-semibold text-zinc-100">Checkpoints:</span> {message.meaningfulLongRun.report.checkpointCount}</p>
                                <p><span className="font-semibold text-zinc-100">Retries:</span> {message.meaningfulLongRun.report.retryCount}</p>
                                <p><span className="font-semibold text-zinc-100">Rollbacks:</span> {message.meaningfulLongRun.report.rollbackCount}</p>
                                <p><span className="font-semibold text-zinc-100">Failures:</span> {message.meaningfulLongRun.report.failureCount}</p>
                                <p><span className="font-semibold text-zinc-100">Useful Work:</span> {String(message.meaningfulLongRun.report.usefulWorkOccurred)}</p>
                                <p><span className="font-semibold text-zinc-100">Meaningful Proof:</span> {String(message.meaningfulLongRun.report.meaningfulLongRunProof)}</p>
                                <p><span className="font-semibold text-zinc-100">Independent Status:</span> {message.meaningfulLongRun.report.independentExclusiveExecutionStatus}</p>
                                <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Truthfulness:</span> {message.meaningfulLongRun.report.truthfulnessLabel}</p>
                                <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Stop Reason:</span> {message.meaningfulLongRun.report.stopReason}</p>
                                <p className="md:col-span-2"><span className="font-semibold text-zinc-100">Summary:</span> {message.meaningfulLongRun.report.summary}</p>
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
                placeholder="Ask AI-E about a Unity feature, bug, design idea, playtest note, or supervised workflow brief..."
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
          <div className="rounded-lg border border-violet-400/30 bg-[#0d1420] p-4 shadow-2xl shadow-black/20">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-200">Active Work Panel</p>
            <h2 className="mt-2 break-words text-lg font-semibold text-zinc-50">{modeSummary.activeCycle}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusPillClass(modeSummary.activeStage)}`}>{modeSummary.activeStage}</span>
              <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusPillClass(modeSummary.activeIndependentStatus)}`}>{modeSummary.activeIndependentStatus}</span>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-semibold text-zinc-100">Elapsed Runtime</dt>
                <dd className="mt-1 text-zinc-300">{modeSummary.activeRuntime}ms</dd>
              </div>
              <div>
                <dt className="font-semibold text-zinc-100">Checkpoint Feed</dt>
                <dd className="mt-1 text-zinc-300">{latestWorkflow?.summaryReport?.checkpointCount ?? 0} checkpoint(s) visible after execution</dd>
              </div>
              <div>
                <dt className="font-semibold text-zinc-100">Mutation Proof</dt>
                <dd className="mt-1 text-zinc-300">{latestWorkflow?.summaryReport?.runtimeTransparency.mutationTrulyOccurred ? "diff preview and changed files visible" : "waiting for approved mutation"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-zinc-100">Validation Proof</dt>
                <dd className="mt-1 text-zinc-300">{latestWorkflow?.summaryReport?.runtimeTransparency.validationTrulyExecuted ? "real validation output captured" : "waiting for approved validation"}</dd>
              </div>
            </dl>
          </div>
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
                <dt className="font-semibold text-zinc-100">Latest Supervised Brief</dt>
                <dd className="mt-1 text-zinc-300">{modeSummary.latestHandoff}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100 shadow-2xl shadow-black/20">
            <p className="font-semibold text-amber-50">Truthful Scope</p>
            <p className="mt-2">This page can prepare supervised repo workflows and launch approved bounded runtime requests. It can show real mutation, validation, checkpoint, retry, and rollback evidence when the trusted server runtime performs it; it still does not provide unrestricted repo control, unattended autonomy, direct Unity control, or overnight background work.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
