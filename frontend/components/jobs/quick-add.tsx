'use client';

import { useState } from 'react';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';
import { JobForm } from './job-form';
import { useParseJobMutation, type ParsedJob } from '../../features/jobs/hooks';

interface QuickAddProps {
  open: boolean;
  onClose: () => void;
}

export function QuickAdd({ open, onClose }: QuickAddProps) {
  const [input, setInput] = useState('');
  const [parsed, setParsed] = useState<ParsedJob | null>(null);

  const mutation = useParseJobMutation((data) => {
    setParsed(data);
    setInput('');
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
