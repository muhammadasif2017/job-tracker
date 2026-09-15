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
  // Parser unreachable: stay on this step with the input kept, so the user
  // can retry or fall back to entering the job by hand.
  const [unavailable, setUnavailable] = useState<ParsedJob | null>(null);

  const mutation = useParseJobMutation((data) => {
    if (data.parserUnavailable) {
      setUnavailable(data);
      return;
    }
    setUnavailable(null);
    setParsed(data);
    setInput('');
  });

  const handleClose = () => {
    setInput('');
    setUnavailable(null);
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
        initialValues={{
          ...parsed,
          // JobForm's fields are plain (non-nullable) strings — a field the
          // parser couldn't find comes back as `null` from the API, which
          // means "leave it blank" here, same as if it had been omitted.
          company: parsed.company ?? undefined,
          position: parsed.position ?? undefined,
          location: parsed.location ?? undefined,
        }}
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
          aria-label="Job posting URL or description"
          placeholder="https://... or paste the job description"
          className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {unavailable && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-paper-raised p-3 text-sm"
          >
            <p className="text-ink">The job parser is unavailable right now.</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setUnavailable(null);
                setInput('');
                setParsed({ ...unavailable, parserUnavailable: undefined });
              }}
            >
              Enter manually
            </Button>
          </div>
        )}
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
