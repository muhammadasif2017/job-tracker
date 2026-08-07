import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '../../lib/api';

export interface ContactPayload {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  notes: string | null;
}

export function useCreateContactMutation(jobId: string, onSuccess?: () => void) {
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
      onSuccess?.();
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to add contact')),
  });
}

export function useUpdateContactMutation(jobId: string, onSuccess?: () => void) {
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
      onSuccess?.();
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to update contact')),
  });
}

export function useRemoveContactMutation(
  jobId: string,
  onSettled?: () => void,
) {
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
    onSettled: () => onSettled?.(),
  });
}
