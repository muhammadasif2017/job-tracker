import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import api, { getErrorMessage } from '../../lib/api';
import type { Resume } from '../../types';

export function useResumeQuery(jobId: string | null, initialResume?: Resume | null) {
  const [initialTimestamp] = useState<number | undefined>(() =>
    initialResume !== undefined ? Date.now() : undefined,
  );

  return useQuery<Resume | null>({
    queryKey: ['resume', jobId],
    // Backend 404s when a job has no resume (matches its sibling
    // resume routes) — map that back to null rather than surfacing an error.
    queryFn: () =>
      api
        .get(`/jobs/${jobId}/resumes`)
        .then((r) => r.data)
        .catch((err: unknown) => {
          if (isAxiosError(err) && err.response?.status === 404) return null;
          throw err;
        }),
    initialData: initialResume !== undefined ? initialResume : undefined,
    initialDataUpdatedAt: initialTimestamp,
    enabled: !!jobId,
    staleTime: 60_000,
  });
}

export function useUploadResumeMutation(jobId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api
        .post(`/jobs/${jobId}/resumes`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          // 8 MB cap (MAX_SIZE in resume-upload.tsx) — 120s is generous even
          // on a slow mobile upload, and still lets a truly stalled
          // connection surface instead of spinning forever.
          timeout: 120_000,
        })
        .then((r) => r.data);
    },
    onSuccess: (data: Resume) => {
      qc.setQueryData(['resume', jobId], data);
      toast.success('Resume uploaded');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Upload failed')),
  });
}

export function useRemoveResumeMutation(
  jobId: string | null,
  onSettled?: () => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/jobs/${jobId}/resumes`).then((r) => r.data),
    onSuccess: () => {
      qc.setQueryData(['resume', jobId], null);
      toast.success('Resume removed');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Remove failed')),
    onSettled: () => onSettled?.(),
  });
}
