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
      <h3 className="font-semibold mb-2">Replay Attempt</h3>
      <div className="text-sm">
        <div><strong>Result:</strong> {replay.result}</div>
        <div><strong>Reason:</strong> {replay.reason}</div>
        <div><strong>Attempted At:</strong> {replay.attemptedAt}</div>
      </div>
    </div>
  );
}
