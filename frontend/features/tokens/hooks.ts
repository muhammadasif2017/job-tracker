import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '../../lib/api';

/** A personal access token as listed, without its secret. */
export interface ApiToken {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

/** A newly created token. `token` is the raw value, returned only this once. */
export interface CreatedApiToken extends ApiToken {
  token: string;
}

/** The user's personal access tokens. */
export function useTokensQuery() {
  return useQuery({
    queryKey: ['tokens'],
    queryFn: () => api.get<ApiToken[]>('/tokens').then((r) => r.data),
  });
}

/**
 * Creates a personal access token; the caller shows the raw value from the
 * result.
 */
export function useCreateTokenMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.post<CreatedApiToken>('/tokens', { name }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tokens'] });
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to create token')),
  });
}

/** Revokes a personal access token. */
export function useRevokeTokenMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/tokens/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tokens'] });
      toast.success('Token revoked');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to revoke token')),
  });
}
