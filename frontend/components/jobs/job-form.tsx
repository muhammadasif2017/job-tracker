'use client';

import { useForm } from 'react-hook-form';
import { useEffect, useState } from 'react';
import { useDebounce } from '../../lib/use-debounce';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Link from 'next/link';
import { Building2, X } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';
import { ResumeUpload } from './resume-upload';
import { CompanyHistoryConfirm } from './company-history-confirm';
import {
  JOB_PRIORITIES,
  DISCOVERY_SOURCES,
  APPLICATION_CHANNELS,
  JOB_STATUSES,
  JOB_TYPES,
  JOB_TYPE_LABELS,
  PRIORITY_LABELS,
  DISCOVERY_SOURCE_LABELS,
  APPLICATION_CHANNEL_LABELS,
  STATUS_LABELS,
  type Job,
  type MatchedCompany,
  type CompanyApplicationHistory,
} from '../../types';
import api, { getErrorMessage } from '../../lib/api';
import { toDateInputValue, todayInputValue } from '../../lib/utils';
import {
  fetchCompanyApplicationHistory,
  useCompanySuggestionsQuery,
} from '../../features/companies/hooks';

const schema = z.object({
  company: z.string().min(1, 'Company is required'),
  position: z.string().min(1, 'Position is required'),
  location: z.string().optional(),
  url: z
    .string()
    .url('Enter a valid URL')
    .refine((v) => /^https?:\/\//i.test(v), {
      message: 'URL must start with http:// or https://',
    })
    .or(z.literal(''))
    .optional(),
  status: z.enum(JOB_STATUSES),
  priority: z.enum(JOB_PRIORITIES),
  jobType: z.enum(JOB_TYPES),
  discoverySource: z.enum(DISCOVERY_SOURCES).or(z.literal('')).optional(),
  applicationChannel: z.enum(APPLICATION_CHANNELS).or(z.literal('')).optional(),
  appliedAt: z.string().optional(),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

type InitialValues = Partial<
  Pick<
    FormData,
    | 'company'
    | 'position'
    | 'location'
    | 'url'
    | 'jobType'
    | 'discoverySource'
    | 'applicationChannel'
  >
>;

interface JobFormProps {
  open: boolean;
  onClose: () => void;
  job?: Job;
  initialValues?: InitialValues;
}

export function JobForm({ open, onClose, job, initialValues }: JobFormProps) {
  const qc = useQueryClient();
  const isEdit = !!job;
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [matchedCompany, setMatchedCompany] = useState<MatchedCompany | null>(
    null,
  );
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Create only: past jobs at the submitted company, awaiting "Add anyway".
  const [companyHistory, setCompanyHistory] =
    useState<CompanyApplicationHistory | null>(null);
  const [checkingHistory, setCheckingHistory] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      status: 'APPLIED',
      priority: 'MEDIUM',
      jobType: 'ONSITE',
      // The viewer's today. `toISOString()` here would prefill UTC's today —
      // yesterday, for anyone east of UTC before their local morning.
      appliedAt: todayInputValue(),
    },
  });

  // Phase 6 (docs/specs/company-fk-phase6.md) — autocomplete on create only;
  // reduces near-duplicate Company creation at the source. `companyFocused`
  // gates the search so opening the modal (which programmatically sets
  // `company` via reset()) never fires a spurious search — only actual
  // typing in the field does. A failed search just shows no suggestions.
  const [companyFocused, setCompanyFocused] = useState(false);
  const companyValue = watch('company') ?? '';
  const debouncedCompany = useDebounce(companyValue);
  const companySuggestions = useCompanySuggestionsQuery(
    debouncedCompany,
    !isEdit && companyFocused,
  );

  const handleClose = () => {
    setCompanyHistory(null);
    setCreatedJobId(null);
    setMatchedCompany(null);
    setBannerDismissed(false);
    setCompanyFocused(false);
    onClose();
  };

  useEffect(() => {
    if (open) {
      setCompanyFocused(false);
      reset(
        job
          ? {
              company: job.company,
              position: job.position,
              location: job.location ?? '',
              status: job.status,
              priority: job.priority,
              jobType: job.jobType,
              discoverySource: job.discoverySource ?? '',
              applicationChannel: job.applicationChannel ?? '',
              url: job.url ?? '',
              appliedAt: job.appliedAt
                ? toDateInputValue(job.appliedAt)
                : undefined,
              notes: job.notes ?? '',
            }
          : {
              status: 'APPLIED',
              priority: 'MEDIUM',
              jobType: 'ONSITE',
              appliedAt: todayInputValue(),
              ...initialValues,
            },
      );
    }
  }, [open, job, initialValues, reset]);

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      // On edit, a field the user emptied out must go over the wire as an
      // explicit `null`: `JSON.stringify` drops `undefined` keys and Prisma
      // treats an omitted column as "leave it alone", so `undefined` would
      // silently keep the old value and make these fields unclearable
      // (ADR-022). On create there is nothing to clear, so omit them.
      const blank = isEdit ? null : undefined;
      const payload = {
        ...data,
        location: data.location || blank,
        url: data.url || blank,
        discoverySource: data.discoverySource || blank,
        applicationChannel: data.applicationChannel || blank,
        notes: data.notes || blank,
      };
      return isEdit
        ? api.patch(`/jobs/${job.id}`, payload).then((r) => r.data)
        : api.post('/jobs', payload).then((r) => r.data);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['analytics', 'funnel'] });
      qc.invalidateQueries({ queryKey: ['attention'] });
      // Company list rows and detail pages carry application stats.
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['company'] });
      if (isEdit) {
        qc.invalidateQueries({ queryKey: ['job', job.id] });
        toast.success('Job updated');
        reset();
        onClose();
      } else {
        toast.success('Job added');
        setCompanyHistory(null);
        setCreatedJobId(data.id);
        setMatchedCompany(data.matchedCompany ?? null);
      }
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Something went wrong')),
  });

  // docs/specs/company-reply-history.md — before creating, show past jobs at
  // the same company. Advisory only: a failed lookup saves anyway.
  const submitCreate = async (data: FormData) => {
    setCheckingHistory(true);
    let history: CompanyApplicationHistory | null = null;
    try {
      history = await fetchCompanyApplicationHistory(data.company);
    } catch {
      history = null;
    } finally {
      setCheckingHistory(false);
    }
    // Optional chaining: an unexpected response shape must not block saving.
    if (history?.recentJobs?.length) {
      setCompanyHistory(history);
    } else {
      mutation.mutate(data);
    }
  };

  const onSubmit = (data: FormData) =>
    isEdit ? mutation.mutate(data) : submitCreate(data);

  // "Add anyway" saves the form as it is now. If the company was edited while
  // the confirm was open, the shown history is for another name, so check
  // again instead.
  const confirmCreate = handleSubmit((data) => {
    const shown = companyHistory?.company?.name.toLowerCase();
    if (shown === data.company.trim().toLowerCase()) {
      mutation.mutate(data);
      return;
    }
    setCompanyHistory(null);
    return submitCreate(data);
  });

  if (createdJobId) {
    return (
      <Modal open={open} onClose={handleClose} title="Job Added">
        <div className="space-y-4">
          {matchedCompany && !bannerDismissed && (
            <div className="flex items-start gap-2 rounded-md bg-accent-soft p-3">
              <Building2 className="h-4 w-4 shrink-0 mt-0.5 text-accent-ink" />
              <p className="flex-1 text-sm text-accent-ink">
                You already saved{' '}
                <Link
                  href={`/companies/${matchedCompany.id}`}
                  className="font-medium underline hover:no-underline"
                >
                  {matchedCompany.name}
                </Link>{' '}
                as a target company.
              </p>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setBannerDismissed(true)}
                className="shrink-0 text-accent/70 hover:text-accent"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <p className="text-sm text-muted">
            Job added successfully. Optionally attach a resume before closing.
          </p>
          <ResumeUpload jobId={createdJobId} initialResume={null} />
          <div className="flex justify-end pt-2">
            <Button
              onClick={() => {
                reset();
                handleClose();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEdit ? 'Edit Job' : 'Add Job'}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="relative">
            <Input
              label="Company *"
              placeholder="Google"
              error={errors.company?.message}
              autoComplete="off"
              {...register('company', {
                onChange: () => setCompanyFocused(true),
                // Delay so a suggestion's onMouseDown-driven select still
                // fires before the list unmounts.
                onBlur: () => setTimeout(() => setCompanyFocused(false), 150),
              })}
              onFocus={() => setCompanyFocused(true)}
            />
            {companyFocused && companySuggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-line bg-paper shadow-lg">
                {companySuggestions.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-paper-raised"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setValue('company', c.name, { shouldValidate: true });
                        setCompanyFocused(false);
                      }}
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Input
            label="Position *"
            placeholder="Senior Engineer"
            error={errors.position?.message}
            {...register('position')}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Location"
            placeholder="Remote / NYC"
            {...register('location')}
          />
          <div className="flex flex-col gap-1">
            <label
              htmlFor="job-status"
              className="font-mono text-xs font-medium uppercase tracking-wide text-muted"
            >
              Status
            </label>
            <select
              id="job-status"
              className="h-9 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink"
              {...register('status')}
            >
              {JOB_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="job-priority"
              className="font-mono text-xs font-medium uppercase tracking-wide text-muted"
            >
              Priority
            </label>
            <select
              id="job-priority"
              className="h-9 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink"
              {...register('priority')}
            >
              {JOB_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="job-type"
              className="font-mono text-xs font-medium uppercase tracking-wide text-muted"
            >
              Job Type
            </label>
            <select
              id="job-type"
              className="h-9 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink"
              {...register('jobType')}
            >
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {JOB_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="job-discovery-source"
              className="font-mono text-xs font-medium uppercase tracking-wide text-muted"
            >
              Discovery Source
            </label>
            <select
              id="job-discovery-source"
              className="h-9 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink"
              {...register('discoverySource')}
            >
              <option value="">—</option>
              {DISCOVERY_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {DISCOVERY_SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="job-application-channel"
              className="font-mono text-xs font-medium uppercase tracking-wide text-muted"
            >
              Application Channel
            </label>
            <select
              id="job-application-channel"
              className="h-9 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink"
              {...register('applicationChannel')}
            >
              <option value="">—</option>
              {APPLICATION_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {APPLICATION_CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Input
          label="Job URL"
          type="url"
          placeholder="https://..."
          error={errors.url?.message}
          {...register('url')}
        />
        <Input label="Applied Date" type="date" {...register('appliedAt')} />
        <div className="flex flex-col gap-1">
          <label
            htmlFor="job-notes"
            className="font-mono text-xs font-medium uppercase tracking-wide text-muted"
          >
            Notes
          </label>
          <textarea
            id="job-notes"
            rows={3}
            placeholder="Recruiter contact, notes…"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink"
            {...register('notes')}
          />
        </div>
        {isEdit && (
          <ResumeUpload jobId={job.id} initialResume={job.resume ?? null} />
        )}
        {companyHistory ? (
          <CompanyHistoryConfirm
            history={companyHistory}
            onConfirm={confirmCreate}
            onCancel={() => setCompanyHistory(null)}
            loading={mutation.isPending}
          />
        ) : (
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={mutation.isPending || checkingHistory}
            >
              {isEdit ? 'Save changes' : 'Add job'}
            </Button>
          </div>
        )}
      </form>
    </Modal>
  );
}
