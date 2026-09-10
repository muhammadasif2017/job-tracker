'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { formatDateTime } from '../../lib/utils';
import api from '../../lib/api';
import {
  useCreateInterviewRoundMutation,
  useInterviewRoundOutcomeMutation,
  useRemoveInterviewRoundMutation,
  useUpdateInterviewRoundMutation,
  useSaveRoundDebriefMutation,
} from '../../features/jobs/interview-rounds.hooks';
import { DERIVED_STATUS_COLORS, DERIVED_STATUS_LABELS } from '../../types';
import type { InterviewOutcome, InterviewRound } from '../../types';

const DEFAULT_ROUND_MINUTES = 60;

// scheduledAt is a real instant (ADR-034, ADR-043) and renders through
// formatDateTime, which reads local getters. The datetime-local input has to
// be built on that same local basis or the row and the form disagree, and the
// changed-field diff below has to compare on it too.
function toLocalInputValue(scheduledAt: string): string {
  const d = new Date(scheduledAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// `<input type="datetime-local">` yields `2026-11-19T14:00` with no offset.
// Sent as-is the backend would resolve it against the *server's* zone, so the
// same request means different instants on different hosts. Resolve it here,
// where the user's own zone is the browser's, and send a real instant.
function toInstant(localValue: string): string {
  return new Date(localValue).toISOString();
}

function formatDuration(minutes: number | null | undefined): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

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
  const [durationMinutes, setDurationMinutes] = useState(
    String(DEFAULT_ROUND_MINUTES),
  );
  const [notes, setNotes] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | undefined>();
  const [editingDebriefId, setEditingDebriefId] = useState<string | null>(null);
  const [debriefText, setDebriefText] = useState('');
  const [editingRoundId, setEditingRoundId] = useState<string | null>(null);
  const [editStage, setEditStage] = useState('');
  const [editScheduledAt, setEditScheduledAt] = useState('');
  const [editDuration, setEditDuration] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editStageError, setEditStageError] = useState<string | undefined>();

  const createMutation = useCreateInterviewRoundMutation(jobId, () => {
    setStage('');
    setScheduledAt('');
    setDurationMinutes(String(DEFAULT_ROUND_MINUTES));
    setNotes('');
    setAdding(false);
    setStageError(undefined);
  });
  const outcomeMutation = useInterviewRoundOutcomeMutation(jobId);
  const removeMutation = useRemoveInterviewRoundMutation(jobId, () =>
    setConfirmingId(null),
  );
  const saveDebriefMutation = useSaveRoundDebriefMutation(jobId);
  const updateMutation = useUpdateInterviewRoundMutation(jobId, () =>
    setEditingRoundId(null),
  );

  function startEdit(round: InterviewRound) {
    setAdding(false);
    setEditingDebriefId(null);
    setEditingRoundId(round.id);
    setEditStage(round.stage);
    setEditScheduledAt(toLocalInputValue(round.scheduledAt));
    setEditDuration(String(round.durationMinutes ?? DEFAULT_ROUND_MINUTES));
    setEditNotes(round.notes ?? '');
    setEditStageError(undefined);
  }

  function handleSaveEdit(e: React.FormEvent, round: InterviewRound) {
    e.preventDefault();
    if (!editStage.trim()) {
      setEditStageError('Stage is required');
      return;
    }
    if (!editScheduledAt || !editDuration) return;
    setEditStageError(undefined);

    // Send only what changed — an unchanged scheduledAt would still clear the
    // round's reminderSentAt on the backend and re-send a sent reminder.
    const payload: {
      stage?: string;
      scheduledAt?: string;
      durationMinutes?: number;
      notes?: string;
    } = {};
    if (editStage.trim() !== round.stage) payload.stage = editStage.trim();
    if (editScheduledAt !== toLocalInputValue(round.scheduledAt)) {
      payload.scheduledAt = toInstant(editScheduledAt);
    }
    if (
      Number(editDuration) !== (round.durationMinutes ?? DEFAULT_ROUND_MINUTES)
    ) {
      payload.durationMinutes = Number(editDuration);
    }
    if (editNotes !== (round.notes ?? '')) payload.notes = editNotes;

    if (Object.keys(payload).length === 0) {
      setEditingRoundId(null);
      return;
    }
    updateMutation.mutate({ roundId: round.id, ...payload });
  }

  function startDebrief(round: InterviewRound) {
    setEditingRoundId(null);
    setEditingDebriefId(round.id);
    setDebriefText(round.notes ?? '');
  }

  function handleSaveDebrief(round: InterviewRound) {
    saveDebriefMutation.mutate(
      { roundId: round.id, outcome: round.outcome, notes: debriefText },
      { onSuccess: () => setEditingDebriefId(null) },
    );
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!stage.trim()) {
      setStageError('Stage is required');
      return;
    }
    if (!scheduledAt || !durationMinutes) return;
    setStageError(undefined);
    createMutation.mutate({
      stage: stage.trim(),
      scheduledAt: toInstant(scheduledAt),
      durationMinutes: Number(durationMinutes),
      notes: notes || undefined,
    });
  }

  async function handleDownloadIcs(roundId: string) {
    try {
      const response = await api.get(
        `/jobs/${jobId}/interview-rounds/${roundId}/ics`,
        { responseType: 'blob' },
      );
      const objectUrl = URL.createObjectURL(response.data as Blob);
      const disposition = response.headers['content-disposition'] as
        string | undefined;
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
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
          Interview Rounds
        </h2>
        {!adding && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setAdding(true);
              setEditingRoundId(null);
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
              label="Date & time"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              required
            />
          </div>
          <Input
            label="Length (minutes)"
            type="number"
            min={5}
            max={1440}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            required
          />
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
        <p className="text-sm text-muted-2">No interview rounds logged yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rounds.map((round) => {
            const canDebrief =
              round.outcome === 'PASSED' || round.outcome === 'FAILED';
            return (
              <li key={round.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{round.stage}</p>
                    <p className="text-xs text-muted">
                      {formatDateTime(round.scheduledAt)}
                      {formatDuration(round.durationMinutes) &&
                        ` · ${formatDuration(round.durationMinutes)}`}
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
                      <span className="text-sm text-muted">Remove?</span>
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
                        aria-label={`Outcome for ${round.stage}`}
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
                        title={`Edit ${round.stage}`}
                        onClick={() => startEdit(round)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {canDebrief && editingDebriefId !== round.id && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => startDebrief(round)}
                        >
                          {round.notes ? 'Edit debrief' : 'Add debrief'}
                        </Button>
                      )}
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
                </div>

                {editingRoundId === round.id && (
                  <form
                    onSubmit={(e) => handleSaveEdit(e, round)}
                    className="flex flex-col gap-3 rounded-md border border-line p-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        id={`edit-stage-${round.id}`}
                        label="Stage"
                        value={editStage}
                        onChange={(e) => {
                          setEditStage(e.target.value);
                          if (editStageError) setEditStageError(undefined);
                        }}
                        error={editStageError}
                        required
                      />
                      <Input
                        id={`edit-date-${round.id}`}
                        label="Date & time"
                        type="datetime-local"
                        value={editScheduledAt}
                        onChange={(e) => setEditScheduledAt(e.target.value)}
                        required
                      />
                    </div>
                    <Input
                      id={`edit-duration-${round.id}`}
                      label="Length (minutes)"
                      type="number"
                      min={5}
                      max={1440}
                      value={editDuration}
                      onChange={(e) => setEditDuration(e.target.value)}
                      required
                    />
                    <Input
                      id={`edit-notes-${round.id}`}
                      label="Notes (optional)"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        loading={updateMutation.isPending}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingRoundId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}

                {editingDebriefId === round.id && (
                  <div className="flex flex-col gap-2 rounded-md border border-line p-3">
                    <label
                      htmlFor={`debrief-${round.id}`}
                      className="font-mono text-xs font-medium uppercase tracking-wide text-muted"
                    >
                      Debrief notes for {round.stage}
                    </label>
                    <textarea
                      id={`debrief-${round.id}`}
                      value={debriefText}
                      onChange={(e) => setDebriefText(e.target.value)}
                      maxLength={5000}
                      rows={3}
                      placeholder="What came up, how it went, anything to prep for next time..."
                      className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted-2 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        loading={saveDebriefMutation.isPending}
                        onClick={() => handleSaveDebrief(round)}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingDebriefId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {round.prepSuggestions && (
                  <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
                    <p className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-accent">
                      Suggested prep for this round
                    </p>
                    <p className="whitespace-pre-line text-sm text-ink">
                      {round.prepSuggestions}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
