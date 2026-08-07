import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '../../lib/api';
import type { InterviewOutcome } from '../../types';

// Creating/updating/removing a round can silently flip Job.status (APPLIED ->
// INTERVIEWING auto-promotion, see interview-rounds.service.ts). Match the
// invalidation set the manual status-change mutation uses
// (usePatchJobStatusMutation) so the Kanban board and dashboard stats don't
// show a stale status.
function invalidateInterviewRoundCaches(qc: QueryClient, jobId: string) {
  qc.invalidateQueries({ queryKey: ['job', jobId] });
  qc.invalidateQueries({ queryKey: ['job-events', jobId] });
  qc.invalidateQueries({ queryKey: ['attention'] });
  qc.invalidateQueries({ queryKey: ['jobs'] });
  qc.invalidateQueries({ queryKey: ['stats'] });
  qc.invalidateQueries({ queryKey: ['analytics', 'funnel'] });
}

export interface CreateInterviewRoundPayload {
  stage: string;
  scheduledAt: string;
  notes?: string;
}

export function useCreateInterviewRoundMutation(
  jobId: string,
  onSuccess?: () => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateInterviewRoundPayload) =>
      api
        .post(`/jobs/${jobId}/interview-rounds`, payload)
        .then((r) => r.data),
    onSuccess: () => {
      invalidateInterviewRoundCaches(qc, jobId);
      toast.success('Interview round added');
      onSuccess?.();
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to add round')),
  });
}

export function useInterviewRoundOutcomeMutation(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
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
      invalidateInterviewRoundCaches(qc, jobId);
      toast.success('Outcome updated');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to update outcome')),
  });
}

export function useRemoveInterviewRoundMutation(
  jobId: string,
  onSettled?: () => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roundId: string) =>
      api
        .delete(`/jobs/${jobId}/interview-rounds/${roundId}`)
        .then((r) => r.data),
    onSuccess: () => {
      invalidateInterviewRoundCaches(qc, jobId);
      toast.success('Interview round removed');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to remove round')),
    onSettled: () => onSettled?.(),
  });
}
