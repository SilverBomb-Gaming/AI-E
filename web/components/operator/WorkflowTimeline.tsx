import React from 'react';

export const ALL_STEPS = [
  'queued',
  'authorization_verified',
  'replay_verified',
  'dispatching',
  'running_step_1',
  'running_step_2',
  'running_step_3',
  'completed'
] as const;

export default function WorkflowTimeline({ lifecycle }: { lifecycle?: Array<{ step: string; at: string }> }) {
  const current = lifecycle && lifecycle.length ? lifecycle[lifecycle.length - 1].step : undefined;

  return (
    <div className="p-4 bg-white rounded shadow-sm">
      <h3 className="font-semibold mb-2">Workflow Timeline</h3>
      <div className="flex flex-col gap-2">
        {ALL_STEPS.map((s) => {
          const status =
            lifecycle && lifecycle.find((l) => l.step === s)
              ? lifecycle[lifecycle.findIndex((l) => l.step === s)].step === current
                ? 'active'
                : 'completed'
              : 'pending';
          const badge = status === 'completed' ? 'bg-green-200' : status === 'active' ? 'bg-blue-200' : 'bg-gray-200';
          return (
            <div key={s} className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${badge}`} />
              <div className="flex-1">
                <div className="text-sm">{s}</div>
                <div className="text-xs text-gray-500">{lifecycle && lifecycle.find((l) => l.step === s)?.at || ''}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
