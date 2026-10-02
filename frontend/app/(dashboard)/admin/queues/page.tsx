'use client';

import { QueueHealthPanel } from '../../../../components/admin/queue-health-panel';

/**
 * Admin queues page (`/admin/queues`): background job depth and enrichment
 * status. No heading of its own: the layout titles the section, and the
 * panel's "Queue health" heading and description already say what this is.
 */
export default function AdminQueuesPage() {
  return <QueueHealthPanel />;
}
