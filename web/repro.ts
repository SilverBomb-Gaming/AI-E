import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { 
    createLocalControlledDispatchTransport,
} from './lib/aie/dispatchTransport';
import {
    executeQueuedTask,
    claimNextRunnableTask,
} from './lib/aie/queueOrchestrator';
import {
    enqueueTask,
    getTask,
} from './lib/aie/taskQueueStore';
import {
    createTaskEnvelope,
} from './lib/aie/taskEnvelope';
import {
    resetExecutionNodeRegistry,
    registerExecutionNode,
} from './lib/aie/executionNodeRegistry';
import {
    createExecutionNodeDescriptor,
} from './lib/aie/executionNode';

async function run() {
    const sessionDirectory = path.resolve(process.cwd(), 'temp-repro-session');
    const taskDirectory = path.resolve(process.cwd(), 'temp-repro-task');
    process.env.AIE_AUTONOMOUS_SESSION_DIR = sessionDirectory;
    process.env.AIE_TASK_QUEUE_DIR = taskDirectory;
    await mkdir(sessionDirectory, { recursive: true });
    await mkdir(taskDirectory, { recursive: true });

    try {
        resetExecutionNodeRegistry();
        registerExecutionNode(createExecutionNodeDescriptor({
            id: 'test-node-1',
            mode: 'headless',
            capabilities: ['validation-check' as any]
        }));

        const now = new Date().toISOString();
        await enqueueTask({
            ...createTaskEnvelope({
                taskId: 'repro-task',
                sessionId: 'repro-session',
                stepIndex: 1,
                action: {
                    id: 'repro-action',
                    type: 'validation-check' as any,
                    scope: 'safe' as any,
                    description: 'Repro task',
                    expectedOutcome: 'Success',
                    requiresApproval: true,
                    metadata: { sourceActionType: 'validation-check' }
                },
                requestedCapabilities: ['validation-check' as any]
            }),
            createdAt: now,
            updatedAt: now
        });

        const claimed = await claimNextRunnableTask({ runtimeMode: 'headless' });
        if (!claimed) throw new Error('Failed to claim task');

        const baseTransport = createLocalControlledDispatchTransport();
        const wrappedTransport = {
            ...baseTransport,
            sendDispatchRequest: async (
                params: Parameters<typeof baseTransport.sendDispatchRequest>[0],
            ) => {
                console.log('--- Dispatch Call ---');
                const result = await baseTransport.sendDispatchRequest(params);
                console.log('Transport Result:', JSON.stringify(result, null, 2));
                return result;
            }
        };

        const summary = await executeQueuedTask(claimed, {
            runtimeMode: 'headless',
            dispatchTransport: wrappedTransport,
            maxDispatchRetries: 1
        });

        console.log('--- Final Summary ---');
        console.log(JSON.stringify(summary, (k, v) => (k === 'task' || k === 'session' || k === 'queueStateSummary') ? undefined : v, 2));
        
        const finalTask = await getTask('repro-task');
        console.log('--- Persisted Task ---');
        console.log(JSON.stringify(finalTask, null, 2));

    } finally {
        await rm(sessionDirectory, { recursive: true, force: true });
        await rm(taskDirectory, { recursive: true, force: true });
    }
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
