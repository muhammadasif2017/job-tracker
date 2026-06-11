'use client';

import { useForm } from 'react-hook-form';
import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';
import {
  JOB_PRIORITIES,
  JOB_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Job,
} from '../../types';
import api from '../../lib/api';

const schema = z.object({
  company: z.string().min(1, 'Company is required'),
  position: z.string().min(1, 'Position is required'),
  location: z.string().optional(),
  url: z.string().url('Enter a valid URL').or(z.literal('')).optional(),
  status: z.enum(JOB_STATUSES),
  priority: z.enum(JOB_PRIORITIES),
  appliedAt: z.string().optional(),
  nextInterviewAt: z.string().optional(),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

interface JobFormProps {
  open: boolean;
  onClose: () => void;
  job?: Job;
}

export function JobForm({ open, onClose, job }: JobFormProps) {
  const qc = useQueryClient();
  const isEdit = !!job;

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
      appliedAt: new Date().toISOString().split('T')[0],
    },
  });

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
              url: job.url ?? '',
              appliedAt: job.appliedAt?.split('T')[0],
              nextInterviewAt: job.nextInterviewAt?.split('T')[0] ?? '',
              notes: job.notes ?? '',
            }
          : {
              status: 'APPLIED',
              priority: 'MEDIUM',
              appliedAt: new Date().toISOString().split('T')[0],
            },
      );
    }
  }, [open, job, reset]);

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      const payload = {
        ...data,
        url: data.url || undefined,
        nextInterviewAt: data.nextInterviewAt || undefined,
      };
      return isEdit
        ? api.patch(`/jobs/${job.id}`, payload).then((r) => r.data)
        : api.post('/jobs', payload).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      if (isEdit) qc.invalidateQueries({ queryKey: ['job', job.id] });
      toast.success(isEdit ? 'Job updated' : 'Job added');
      reset();
      onClose();
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.message ?? 'Something went wrong'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Job' : 'Add Job'}
    >
      <form
        onSubmit={handleSubmit((d) => mutation.mutate(d))}
        className="space-y-4"
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
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Status
            </label>
            <select
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
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Priority
            </label>
            <select
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
        </div>
        <Input
          label="Job URL"
          type="url"
          placeholder="https://..."
          error={errors.url?.message}
          {...register('url')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Applied Date" type="date" {...register('appliedAt')} />
          <Input
            label="Next Interview Date"
            type="date"
            {...register('nextInterviewAt')}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Notes
          </label>
          <textarea
            rows={3}
            placeholder="Recruiter contact, notes…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            {...register('notes')}
          />
        </div>
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
