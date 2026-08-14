import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '../../lib/api';
import type {
  Company,
  CompanyCity,
  CsvImportResult,
  JobPriority,
  PaginatedCompanies,
} from '../../types';

export interface CompaniesFilters {
  page: number;
  search: string;
  city: CompanyCity | '';
  priority: JobPriority | '';
}

function invalidateCompanyListCaches(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['companies'] });
}

export function useCompaniesQuery(filters: CompaniesFilters) {
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: '10',
    ...(filters.search && { search: filters.search }),
    ...(filters.city && { city: filters.city }),
    ...(filters.priority && { priority: filters.priority }),
  });

  return useQuery<PaginatedCompanies>({
    queryKey: ['companies', filters],
    queryFn: () => api.get(`/companies?${params}`).then((r) => r.data),
  });
}

export function useCompanyQuery(id: string) {
  return useQuery<Company>({
    queryKey: ['company', id],
    queryFn: () => api.get(`/companies/${id}`).then((r) => r.data),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'PENDING' || status === 'PROCESSING' ? 3000 : false;
    },
  });
}

export function useCreateCompanyMutation(onCreated?: (company: Company) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: Partial<Company>) =>
      api.post<Company>('/companies', dto).then((r) => r.data),
    onSuccess: (company) => {
      invalidateCompanyListCaches(qc);
      toast.success('Company added');
      onCreated?.(company);
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, 'Failed to add company'));
    },
  });
}

export function useUpdateCompanyMutation(
  id: string,
  onUpdated?: (company: Company) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: Partial<Company>) =>
      api.patch<Company>(`/companies/${id}`, dto).then((r) => r.data),
    onSuccess: (company) => {
      qc.setQueryData(['company', id], company);
      invalidateCompanyListCaches(qc);
      toast.success('Company updated');
      onUpdated?.(company);
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, 'Failed to update company'));
    },
  });
}

export function useDeleteCompanyMutation(onDeleted?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/companies/${id}`),
    onSuccess: () => {
      invalidateCompanyListCaches(qc);
      toast.success('Company deleted');
      onDeleted?.();
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, 'Failed to delete company'));
    },
  });
}

export function useCompanyEnrichmentMutation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/companies/${id}/enrichment`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', id] });
      toast.success('Researching company…');
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, 'Failed to queue enrichment'));
    },
  });
}

export interface CompanyContactPayload {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  notes: string | null;
}

export function useCreateCompanyContactMutation(
  companyId: string,
  onSuccess?: () => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CompanyContactPayload) =>
      api.post(`/companies/${companyId}/contacts`, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', companyId] });
      toast.success('Contact added');
      onSuccess?.();
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to add contact')),
  });
}

export function useUpdateCompanyContactMutation(
  companyId: string,
  onSuccess?: () => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      contactId,
      payload,
    }: {
      contactId: string;
      payload: CompanyContactPayload;
    }) =>
      api
        .patch(`/companies/${companyId}/contacts/${contactId}`, payload)
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', companyId] });
      toast.success('Contact updated');
      onSuccess?.();
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to update contact')),
  });
}

export function useRemoveCompanyContactMutation(
  companyId: string,
  onSettled?: () => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) =>
      api
        .delete(`/companies/${companyId}/contacts/${contactId}`)
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', companyId] });
      toast.success('Contact removed');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to remove contact')),
    onSettled: () => onSettled?.(),
  });
}

export function useImportCompaniesCsvMutation(onSuccess?: (result: CsvImportResult) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api
        .post<CsvImportResult>('/companies/import', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data);
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      if (result.errors.length === 0) {
        toast.success(`Imported ${result.imported} companies`);
      } else {
        toast.warning(
          `Imported ${result.imported} companies, ${result.errors.length} row(s) skipped`,
        );
      }
      onSuccess?.(result);
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Import failed')),
  });
}
