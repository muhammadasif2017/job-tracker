import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '../../lib/api';

/**
 * Body for creating or editing a job contact. Emptied fields are sent as
 * `null` (ADR-022).
 */
export interface ContactPayload {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  notes: string | null;
}

/** Adds a contact to a job. */
export function useCreateContactMutation(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ContactPayload) =>
      api.post(`/jobs/${jobId}/contacts`, payload).then((r) => r.data),
    onSuccess: () => {
      // Contacts never touch Job.status/nextInterviewAt, so the job detail
      // query is the only cache that needs refreshing — unlike interview
      // rounds, there's no Kanban/stats/funnel invalidation to do here.
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      toast.success('Contact added');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to add contact')),
  });
}

/** Edits a contact on a job. */
export function useUpdateContactMutation(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      contactId,
      payload,
    }: {
      contactId: string;
      payload: ContactPayload;
    }) =>
      api
        .patch(`/jobs/${jobId}/contacts/${contactId}`, payload)
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      toast.success('Contact updated');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to update contact')),
  });
}

/** Removes a contact from a job. */
export function useRemoveContactMutation(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) =>
      api.delete(`/jobs/${jobId}/contacts/${contactId}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      toast.success('Contact removed');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to remove contact')),
  });
}
