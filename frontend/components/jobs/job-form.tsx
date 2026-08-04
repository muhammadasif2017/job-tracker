'use client';

import { useForm } from 'react-hook-form';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';
import { ResumeUpload } from './resume-upload';
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
} from '../../types';
import api, { getErrorMessage } from '../../lib/api';

const schema = z.object({
  company: z.string().min(1, 'Company is required'),
  position: z.string().min(1, 'Position is required'),
  location: z.string().optional(),
  url: z.string().url('Enter a valid URL').or(z.literal('')).optional(),
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

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      status: 'APPLIED',
      priority: 'MEDIUM',
      jobType: 'ONSITE',
      appliedAt: new Date().toISOString().split('T')[0],
    },
  });

  const handleClose = () => {
    setCreatedJobId(null);
    onClose();
  };

  useEffect(() => {
    if (open) {
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
              appliedAt: job.appliedAt?.split('T')[0],
              notes: job.notes ?? '',
            }
          : {
              status: 'APPLIED',
              priority: 'MEDIUM',
              jobType: 'ONSITE',
              appliedAt: new Date().toISOString().split('T')[0],
              ...initialValues,
            },
      );
    }
  }, [open, job, initialValues, reset]);

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      const payload = {
        ...data,
        url: data.url || undefined,
        discoverySource: data.discoverySource || undefined,
        applicationChannel: data.applicationChannel || undefined,
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
      if (isEdit) {
        qc.invalidateQueries({ queryKey: ['job', job.id] });
        toast.success('Job updated');
        reset();
        onClose();
      } else {
        toast.success('Job added');
        setCreatedJobId(data.id);
      }
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Something went wrong')),
  });

  if (createdJobId) {
    return (
      <Modal open={open} onClose={handleClose} title="Job Added">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
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
      <form
        onSubmit={handleSubmit((d) => mutation.mutate(d))}
        className="space-y-4"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Company *"
            placeholder="Google"
            error={errors.company?.message}
            {...register('company')}
          />
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
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Status
            </label>
            <select
              id="job-status"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Priority
            </label>
            <select
              id="job-priority"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Job Type
            </label>
            <select
              id="job-type"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Discovery Source
            </label>
            <select
              id="job-discovery-source"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Application Channel
            </label>
            <select
              id="job-application-channel"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
            className="text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Notes
          </label>
          <textarea
            id="job-notes"
            rows={3}
            placeholder="Recruiter contact, notes…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            {...register('notes')}
          />
        </div>
        {isEdit && (
          <ResumeUpload jobId={job.id} initialResume={job.resume ?? null} />
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Add job'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
