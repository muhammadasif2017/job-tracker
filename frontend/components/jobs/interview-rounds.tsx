'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { formatDate } from '../../lib/utils';
import api from '../../lib/api';
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
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [stage, setStage] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['job', jobId] });
    qc.invalidateQueries({ queryKey: ['attention'] });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api
        .post(`/jobs/${jobId}/interview-rounds`, {
          stage,
          scheduledAt,
          notes: notes || undefined,
        })
        .then((r) => r.data),
    onSuccess: () => {
      invalidate();
      setStage('');
      setScheduledAt('');
      setNotes('');
      setAdding(false);
      toast.success('Interview round added');
    },
    onError: (err: unknown) =>
      toast.error(
        isAxiosError(err)
          ? (err.response?.data?.message ?? 'Failed to add round')
          : 'Failed to add round',
      ),
  });

  const outcomeMutation = useMutation({
    mutationFn: ({
      roundId,
      outcome,
    }: {
      roundId: string;
      outcome: InterviewOutcome;
    }) =>
      api
        .patch(`/jobs/${jobId}/interview-rounds/${roundId}`, { outcome })
        .then((r) => r.data),
    onSuccess: () => {
      invalidate();
      toast.success('Outcome updated');
    },
    onError: (err: unknown) =>
      toast.error(
        isAxiosError(err)
          ? (err.response?.data?.message ?? 'Failed to update outcome')
          : 'Failed to update outcome',
      ),
  });

  const removeMutation = useMutation({
    mutationFn: (roundId: string) =>
      api
        .delete(`/jobs/${jobId}/interview-rounds/${roundId}`)
        .then((r) => r.data),
    onSuccess: () => {
      invalidate();
      setConfirmingId(null);
      toast.success('Interview round removed');
    },
    onError: (err: unknown) => {
      setConfirmingId(null);
      toast.error(
        isAxiosError(err)
          ? (err.response?.data?.message ?? 'Failed to remove round')
          : 'Failed to remove round',
      );
    },
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!stage.trim() || !scheduledAt) return;
    createMutation.mutate();
  }

  return (
    <div className="rounded-xl border bg-white p-6 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Interview Rounds</h2>
        {!adding && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-4 w-4" />
            Add Round
          </Button>
        )}
      </div>

      {adding && (
        <form
          onSubmit={handleAdd}
          className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Stage"
              placeholder="Phone Screen"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
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
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {rounds.length === 0 ? (
        <p className="text-sm text-slate-400">
          No interview rounds logged yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rounds.map((round) => (
            <li
              key={round.id}
              className="flex flex-wrap items-center gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{round.stage}</p>
                <p className="text-xs text-slate-500">
                  {formatDate(round.scheduledAt)}
                </p>
                {round.notes && (
                  <p className="mt-1 text-xs text-slate-500">{round.notes}</p>
                )}
              </div>

              {confirmingId === round.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600 dark:text-slate-400">
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
                    className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
                    className="text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
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
