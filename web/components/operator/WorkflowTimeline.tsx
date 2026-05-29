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
      <h3 className="font-semibold mb-3">Workflow Timeline</h3>
      <div className="flex flex-col gap-3">
        {ALL_STEPS.map((s) => {
          const found = lifecycle && lifecycle.find((l) => l.step === s);
          const status = found ? (found.step === current ? 'active' : 'completed') : 'pending';
          const badge = status === 'completed' ? 'bg-green-500' : status === 'active' ? 'bg-blue-500' : 'bg-gray-300';
          return (
            <div key={s} className="flex items-start gap-3">
              <div className={`mt-1 w-3 h-3 rounded-full ${badge}`} />
              <div className="flex-1">
                <div className={`text-sm ${status === 'active' ? 'font-semibold' : ''}`}>{s.replace(/_/g, ' ')}</div>
                <div className="text-xs text-gray-500 mt-1">{found?.at || ''}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
