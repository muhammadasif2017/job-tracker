'use client';

import { QueueHealthPanel } from '../../../../components/admin/queue-health-panel';

export default function AdminQueuesPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Admin — Queues
        </h1>
        <p className="text-sm text-muted">
          Background job depth and enrichment status
        </p>
      </div>

      <QueueHealthPanel />
    </div>
  );
}
