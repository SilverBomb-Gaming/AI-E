import {
  createDispatchEnvelope,
  deserializeDispatchEnvelope,
  serializeDispatchEnvelope,
  type DispatchEnvelope,
} from "./dispatchProtocol";
import {
  createTaskDispatchAck,
  createTaskDispatchError,
  createTaskDispatchResult,
  validateDispatchEnvelopePayload,
  type TaskDispatchAckPayload,
  type TaskDispatchErrorPayload,
  type TaskDispatchRequestPayload,
  type TaskDispatchResultPayload,
} from "./dispatchMessages";
import type { AutonomousSession } from "./autonomousSession";
import { handleDispatchRequest, type DispatchReceiverDependencies, type DispatchReceiverResult } from "./dispatchReceiver";
import type { TaskEnvelope } from "./taskEnvelope";

export type SimulatedDispatchRoundTrip = {
  request: DispatchEnvelope<TaskDispatchRequestPayload>;
  ack: DispatchEnvelope<TaskDispatchAckPayload>;
  result?: DispatchEnvelope<TaskDispatchResultPayload>;
  error?: DispatchEnvelope<TaskDispatchErrorPayload>;
};

export type DispatchTransportStatus = "accepted" | "rejected" | "delivered" | "failed";

export type DispatchTransportRequestResult = {
  status: DispatchTransportStatus;
  request: DispatchEnvelope<TaskDispatchRequestPayload>;
  ack?: DispatchEnvelope<TaskDispatchAckPayload>;
  result?: DispatchEnvelope<TaskDispatchResultPayload>;
  error?: DispatchEnvelope<TaskDispatchErrorPayload>;
  rawRequest: string;
  rawAck?: string;
  rawResult?: string;
  rawError?: string;
  task?: TaskEnvelope | null;
  session?: AutonomousSession | null;
  authSummary?: string;
  reason?: string;
};

export type LocalControlledTransportContext = {
  runtimeMode?: "web" | "headless" | "local";
  cwd?: string;
  allowedRoots?: string[];
  maxSteps?: number;
};

export type DispatchTransport = {
  sendDispatchRequest: (params: {
    request: DispatchEnvelope<TaskDispatchRequestPayload>;
    context?: LocalControlledTransportContext;
    dependencies: DispatchReceiverDependencies;
  }) => Promise<DispatchTransportRequestResult>;
  receiveDispatchRequest: (params: {
    request?: DispatchEnvelope<TaskDispatchRequestPayload>;
    rawRequest?: string;
    context?: LocalControlledTransportContext;
    dependencies: DispatchReceiverDependencies;
  }) => Promise<DispatchReceiverResult>;
  sendDispatchAck: (envelope: DispatchEnvelope<TaskDispatchAckPayload>) => Promise<string>;
  sendDispatchResult: (envelope: DispatchEnvelope<TaskDispatchResultPayload>) => Promise<string>;
  sendDispatchError: (envelope: DispatchEnvelope<TaskDispatchErrorPayload>) => Promise<string>;
};

export async function sendDispatchMessage<TPayload>(envelope: DispatchEnvelope<TPayload>): Promise<string> {
  if (!validateDispatchEnvelopePayload(envelope as DispatchEnvelope)) {
    throw new Error("The dispatch message payload is invalid for the declared message type.");
  }

  return serializeDispatchEnvelope(envelope);
}

export async function receiveDispatchMessage(raw: string): Promise<DispatchEnvelope | null> {
  const envelope = deserializeDispatchEnvelope(raw);
  if (!envelope || !validateDispatchEnvelopePayload(envelope)) {
    return null;
  }

  return envelope;
}

export async function sendDispatchAck(envelope: DispatchEnvelope<TaskDispatchAckPayload>): Promise<string> {
  if (envelope.messageType !== "task-dispatch-ack") {
    throw new Error("Only acknowledgment envelopes can be sent through sendDispatchAck.");
  }

  return sendDispatchMessage(envelope);
}

export async function sendDispatchResult(envelope: DispatchEnvelope<TaskDispatchResultPayload>): Promise<string> {
  if (envelope.messageType !== "task-dispatch-result") {
    throw new Error("Only result envelopes can be sent through sendDispatchResult.");
  }

  return sendDispatchMessage(envelope);
}

export async function sendDispatchError(envelope: DispatchEnvelope<TaskDispatchErrorPayload>): Promise<string> {
  if (envelope.messageType !== "task-dispatch-error") {
    throw new Error("Only error envelopes can be sent through sendDispatchError.");
  }

  return sendDispatchMessage(envelope);
}

export function createLocalControlledDispatchTransport(): DispatchTransport {
  return {
    async sendDispatchRequest(params) {
      const rawRequest = await sendDispatchMessage(params.request);
      const received = await handleDispatchRequest({
        request: params.request,
        rawRequest,
        executionContext: params.context,
        dependencies: params.dependencies,
      });
      const rawAck = received.ack ? await sendDispatchAck(received.ack as DispatchEnvelope<TaskDispatchAckPayload>) : undefined;
      const rawResult = received.result
        ? await sendDispatchResult(received.result as DispatchEnvelope<TaskDispatchResultPayload>)
        : undefined;
      const rawError = received.error
        ? await sendDispatchError(received.error as DispatchEnvelope<TaskDispatchErrorPayload>)
        : undefined;

      return {
        status: received.status === "accepted"
          ? (received.result ? "delivered" : "accepted")
          : received.status,
        request: received.request,
        ack: received.ack as DispatchEnvelope<TaskDispatchAckPayload>,
        result: received.result as DispatchEnvelope<TaskDispatchResultPayload> | undefined,
        error: received.error as DispatchEnvelope<TaskDispatchErrorPayload> | undefined,
        rawRequest,
        rawAck,
        rawResult,
        rawError,
        task: received.task,
        session: received.session,
        authSummary: received.authSummary,
        reason: received.reason,
      };
    },
    async receiveDispatchRequest(params) {
      return handleDispatchRequest({
        request: params.request,
        rawRequest: params.rawRequest,
        executionContext: params.context,
        dependencies: params.dependencies,
      });
    },
    sendDispatchAck,
    sendDispatchResult,
    sendDispatchError,
  };
}

export function simulateLocalDispatchRoundTrip(params: {
  request: DispatchEnvelope<TaskDispatchRequestPayload>;
  accepted?: boolean;
  ackReason?: string;
  resultPayload?: TaskDispatchResultPayload;
  errorPayload?: TaskDispatchErrorPayload;
}): SimulatedDispatchRoundTrip {
  if (!validateDispatchEnvelopePayload(params.request)) {
    throw new Error("Cannot simulate a dispatch round trip for an invalid request payload.");
  }

  const accepted = params.accepted ?? !params.errorPayload;
  const ack = createDispatchEnvelope({
    messageType: "task-dispatch-ack",
    sourceNodeId: params.request.targetNodeId,
    targetNodeId: params.request.sourceNodeId,
    taskId: params.request.taskId,
    sessionId: params.request.sessionId,
    payload: createTaskDispatchAck({
      accepted,
      reason: params.ackReason,
    }),
  });

  if (params.errorPayload) {
    return {
      request: params.request,
      ack,
      error: createDispatchEnvelope({
        messageType: "task-dispatch-error",
        sourceNodeId: params.request.targetNodeId,
        targetNodeId: params.request.sourceNodeId,
        taskId: params.request.taskId,
        sessionId: params.request.sessionId,
        payload: createTaskDispatchError(params.errorPayload),
      }),
    };
  }

  return {
    request: params.request,
    ack,
    result: params.resultPayload
      ? createDispatchEnvelope({
          messageType: "task-dispatch-result",
          sourceNodeId: params.request.targetNodeId,
          targetNodeId: params.request.sourceNodeId,
          taskId: params.request.taskId,
          sessionId: params.request.sessionId,
          payload: createTaskDispatchResult(params.resultPayload),
        })
      : undefined,
  };
}
