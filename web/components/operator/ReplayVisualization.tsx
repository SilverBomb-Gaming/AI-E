import React from 'react';

export default function ReplayVisualization({ replay }: { replay?: any }) {
  if (!replay) return (
    <div className="p-4 bg-white rounded shadow-sm">
      <h3 className="font-semibold mb-2">Replay</h3>
      <div className="text-sm">REPLAY PROTECTED</div>
    </div>
  );
  return (
    <div className="p-4 bg-white rounded shadow-sm">
      <h3 className="font-semibold mb-3">Replay Attempt</h3>
      <div className="text-sm space-y-2">
        <div>
          <div className="text-xs text-gray-500">Result</div>
          <div className="mt-1 inline-block px-2 py-1 rounded text-sm font-semibold bg-red-100 text-red-800">{replay.result}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Reason</div>
          <div className="mt-1 font-mono text-sm bg-gray-50 p-2 rounded">{replay.reason}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Attempted At</div>
          <div className="mt-1 text-sm">{replay.attemptedAt}</div>
        </div>
      </div>
    </div>
  );
}
