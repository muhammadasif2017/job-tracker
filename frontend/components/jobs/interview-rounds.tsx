'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarPlus, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { formatDateOnly } from '../../lib/utils';
import api from '../../lib/api';
import {
  useCreateInterviewRoundMutation,
  useInterviewRoundOutcomeMutation,
  useRemoveInterviewRoundMutation,
} from '../../features/jobs/interview-rounds.hooks';
import {
  DERIVED_STATUS_COLORS,
  DERIVED_STATUS_LABELS,
} from '../../types';
import type { InterviewOutcome, InterviewRound } from '../../types';

const OUTCOMES: InterviewOutcome[] = [
  'PENDING',
  'PASSED',
  'FAILED',
  'CANCELLED',
];

interface InterviewRoundsProps {
  jobId: string;
  rounds: InterviewRound[];
}

export function InterviewRounds({ jobId, rounds }: InterviewRoundsProps) {
  const [adding, setAdding] = useState(false);
  const [stage, setStage] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | undefined>();

  const createMutation = useCreateInterviewRoundMutation(jobId, () => {
    setStage('');
    setScheduledAt('');
    setNotes('');
    setAdding(false);
    setStageError(undefined);
  });
  const outcomeMutation = useInterviewRoundOutcomeMutation(jobId);
  const removeMutation = useRemoveInterviewRoundMutation(jobId, () =>
    setConfirmingId(null),
  );

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!stage.trim()) {
      setStageError('Stage is required');
      return;
    }
    if (!scheduledAt) return;
    setStageError(undefined);
    createMutation.mutate({ stage: stage.trim(), scheduledAt, notes: notes || undefined });
  }

  async function handleDownloadIcs(roundId: string) {
    try {
      const response = await api.get(
        `/jobs/${jobId}/interview-rounds/${roundId}/ics`,
        { responseType: 'blob' },
      );
      const objectUrl = URL.createObjectURL(response.data as Blob);
      const disposition = response.headers['content-disposition'] as
        | string
        | undefined;
      const filename =
        disposition?.match(/filename="([^"]+)"/)?.[1] ?? 'interview.ics';
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      toast.error('Failed to download calendar file');
    }
  }

  return (
    <div className="rounded-md border border-line bg-paper p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">Interview Rounds</h2>
        {!adding && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setAdding(true);
              setStageError(undefined);
            }}
          >
            <Plus className="h-4 w-4" />
            Add Round
          </Button>
        )}
      </div>

      {adding && (
        <form
          onSubmit={handleAdd}
          className="mb-4 flex flex-col gap-3 rounded-md border border-line p-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Stage"
              placeholder="Phone Screen"
              value={stage}
              onChange={(e) => {
                setStage(e.target.value);
                if (stageError) setStageError(undefined);
              }}
              error={stageError}
              required
            />
            <Input
              label="Date"
              type="date"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              required
            />
          </div>
          <Input
            label="Notes (optional)"
            placeholder="Ask about on-call rotation"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={createMutation.isPending}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false);
                setStageError(undefined);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {rounds.length === 0 ? (
        <p className="text-sm text-muted-2">
          No interview rounds logged yet.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {rounds.map((round) => (
            <li
              key={round.id}
              className="flex flex-wrap items-center gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{round.stage}</p>
                <p className="text-xs text-muted">
                  {formatDateOnly(round.scheduledAt)}
                </p>
                {round.notes && (
                  <p className="mt-1 text-xs text-muted">{round.notes}</p>
                )}
                {DERIVED_STATUS_LABELS[round.derivedStatus] && (
                  <span
                    className={`mt-1 inline-block rounded-sm border border-line/70 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide ${DERIVED_STATUS_COLORS[round.derivedStatus]}`}
                  >
                    {DERIVED_STATUS_LABELS[round.derivedStatus]}
                  </span>
                )}
              </div>

              {confirmingId === round.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted">
                    Remove?
                  </span>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    loading={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(round.id)}
                  >
                    Yes
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingId(null)}
                  >
                    No
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    value={round.outcome}
                    onChange={(e) =>
                      outcomeMutation.mutate({
                        roundId: round.id,
                        outcome: e.target.value as InterviewOutcome,
                      })
                    }
                    className="h-8 rounded-md border border-line bg-paper px-2 text-sm text-ink"
                  >
                    {OUTCOMES.map((o) => (
                      <option key={o} value={o}>
                        {o.charAt(0) + o.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title="Add to calendar"
                    onClick={() => handleDownloadIcs(round.id)}
                  >
                    <CalendarPlus className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title="Remove round"
                    className="text-danger hover:bg-danger-soft hover:text-danger"
                    onClick={() => setConfirmingId(round.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
