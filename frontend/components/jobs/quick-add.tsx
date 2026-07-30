'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';
import { JobForm } from './job-form';
import api from '../../lib/api';
import type { JobType, JobSource } from '../../types';

interface ParsedJob {
  company?: string;
  position?: string;
  location?: string;
  url?: string;
  jobType?: JobType;
  source?: JobSource;
}

interface QuickAddProps {
  open: boolean;
  onClose: () => void;
}

function looksLikeUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function QuickAdd({ open, onClose }: QuickAddProps) {
  const [input, setInput] = useState('');
  const [parsed, setParsed] = useState<ParsedJob | null>(null);

  const mutation = useMutation({
    mutationFn: (value: string) => {
      const payload = looksLikeUrl(value)
        ? { url: value.trim() }
        : { text: value };
      return api
        .post<ParsedJob>('/jobs/parse', payload)
        .then((r) => r.data);
    },
    onSuccess: (data) => {
      setParsed(data);
      setInput('');
    },
    onError: (err: unknown) =>
      toast.error(
        isAxiosError(err)
          ? (err.response?.data?.message ?? 'Could not parse that posting')
          : 'Could not parse that posting',
      ),
  });

  const handleClose = () => {
    setInput('');
    mutation.reset();
    onClose();
  };

  if (parsed) {
    return (
      <JobForm
        open={open}
        onClose={() => {
          setParsed(null);
          onClose();
        }}
        initialValues={parsed}
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Quick Add"
      description="Paste a job posting URL or the job description text"
    >
      <div className="space-y-4">
        <textarea
          rows={6}
          autoFocus
          placeholder="https://... or paste the job description"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={mutation.isPending}
            disabled={!input.trim()}
            onClick={() => mutation.mutate(input)}
          >
            Parse &amp; Continue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
