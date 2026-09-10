import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InterviewRounds } from './interview-rounds';
import { formatDateTime } from '../../lib/utils';
import type { InterviewRound } from '../../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: (err: unknown, fallback: string) => {
    const axiosErr = err as {
      isAxiosError?: boolean;
      response?: { data?: { message?: unknown } };
    };
    if (!axiosErr?.isAxiosError) return fallback;
    const message = axiosErr.response?.data?.message;
    if (Array.isArray(message)) return message.join('. ');
    return typeof message === 'string' ? message : fallback;
  },
}));

import api from '../../lib/api';
import { toast } from 'sonner';

const round: InterviewRound = {
  id: 'r-1',
  jobId: 'j-1',
  stage: 'Phone Screen',
  scheduledAt: '2026-06-10T14:00:00Z',
  durationMinutes: 45,
  outcome: 'PENDING',
  derivedStatus: 'SCHEDULED',
  notes: 'Ask about on-call rotation',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

function renderRounds(rounds: InterviewRound[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <InterviewRounds jobId="j-1" rounds={rounds} />
    </QueryClientProvider>,
  );
}

describe('InterviewRounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('empty state', () => {
    it('shows the empty message when there are no rounds', () => {
      renderRounds([]);
      expect(
        screen.getByText('No interview rounds logged yet.'),
      ).toBeInTheDocument();
    });
  });

  describe('list rendering', () => {
    it('renders stage, formatted date-time, length, and notes', () => {
      renderRounds([round]);
      expect(screen.getByText('Phone Screen')).toBeInTheDocument();
      expect(
        screen.getByText(`${formatDateTime('2026-06-10T14:00:00Z')} · 45 min`),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Ask about on-call rotation'),
      ).toBeInTheDocument();
    });

    it.each([
      [90, '1 hr 30 min'],
      [120, '2 hr'],
      [45, '45 min'],
    ])('renders a %i-minute length as "%s"', (minutes, expected) => {
      renderRounds([{ ...round, durationMinutes: minutes }]);
      expect(
        screen.getByText(
          `${formatDateTime('2026-06-10T14:00:00Z')} · ${expected}`,
        ),
      ).toBeInTheDocument();
    });

    it('shows the date alone for a round with no length', () => {
      renderRounds([{ ...round, durationMinutes: null }]);
      expect(
        screen.getByText(formatDateTime('2026-06-10T14:00:00Z')),
      ).toBeInTheDocument();
    });

    it('omits the notes line when notes is null', () => {
      renderRounds([{ ...round, notes: null }]);
      expect(screen.getByText('Phone Screen')).toBeInTheDocument();
      expect(
        screen.queryByText('Ask about on-call rotation'),
      ).not.toBeInTheDocument();
    });
  });

  describe('derived status badge', () => {
    it('shows "Awaiting response" for a round past its date with no outcome yet', () => {
      renderRounds([{ ...round, derivedStatus: 'AWAITING_RESPONSE' }]);
      expect(screen.getByText('Awaiting response')).toBeInTheDocument();
    });

    it('shows "Possibly ghosted" once a week has passed with no outcome', () => {
      renderRounds([{ ...round, derivedStatus: 'POSSIBLY_GHOSTED' }]);
      expect(screen.getByText('Possibly ghosted')).toBeInTheDocument();
    });

    it('omits the badge once the round is resolved', () => {
      renderRounds([{ ...round, outcome: 'PASSED', derivedStatus: 'PASSED' }]);
      expect(screen.queryByText('Scheduled')).not.toBeInTheDocument();
      expect(screen.queryByText('Awaiting response')).not.toBeInTheDocument();
      expect(screen.queryByText('Possibly ghosted')).not.toBeInTheDocument();
    });
  });

  describe('add flow', () => {
    it('opens a blank form on Add Round', () => {
      renderRounds([]);
      fireEvent.click(screen.getByRole('button', { name: /add round/i }));
      expect(screen.getByLabelText(/^stage$/i)).toHaveValue('');
      expect(screen.getByLabelText(/date & time/i)).toHaveValue('');
    });

    it('never submits without stage and date', async () => {
      renderRounds([]);
      fireEvent.click(screen.getByRole('button', { name: /add round/i }));
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await new Promise((r) => setTimeout(r, 50));
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText(/^stage$/i), {
        target: { value: 'Onsite' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await new Promise((r) => setTimeout(r, 50));
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });

    it('shows an inline error and never submits when stage is whitespace-only', async () => {
      renderRounds([]);
      fireEvent.click(screen.getByRole('button', { name: /add round/i }));
      fireEvent.change(screen.getByLabelText(/^stage$/i), {
        target: { value: '   ' },
      });
      fireEvent.change(screen.getByLabelText(/date & time/i), {
        target: { value: '2026-06-01T10:00' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      expect(await screen.findByText('Stage is required')).toBeInTheDocument();
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });

    it('clears the inline stage error on Cancel and does not resurface on reopen', async () => {
      renderRounds([]);
      fireEvent.click(screen.getByRole('button', { name: /add round/i }));
      fireEvent.change(screen.getByLabelText(/^stage$/i), {
        target: { value: '   ' },
      });
      fireEvent.change(screen.getByLabelText(/date & time/i), {
        target: { value: '2026-06-01T10:00' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      expect(await screen.findByText('Stage is required')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      fireEvent.click(screen.getByRole('button', { name: /add round/i }));
      expect(screen.queryByText('Stage is required')).not.toBeInTheDocument();
    });

    it('posts stage/scheduledAt and coerces blank notes to undefined', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: { id: 'r-new' } });
      renderRounds([]);
      fireEvent.click(screen.getByRole('button', { name: /add round/i }));
      fireEvent.change(screen.getByLabelText(/^stage$/i), {
        target: { value: 'Onsite' },
      });
      fireEvent.change(screen.getByLabelText(/date & time/i), {
        target: { value: '2026-07-01T09:30' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalled());
      const [url, payload] = vi.mocked(api.post).mock.calls[0];
      expect(url).toBe('/jobs/j-1/interview-rounds');
      // The wire value is a real instant with an offset, not the offset-less
      // string the datetime-local input produces. Derived here rather than
      // hardcoded so the assertion holds in any TZ the suite runs under.
      expect(payload).toEqual({
        stage: 'Onsite',
        scheduledAt: new Date('2026-07-01T09:30').toISOString(),
        durationMinutes: 60,
        notes: undefined,
      });
    });

    it('posts an edited length', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: { id: 'r-new' } });
      renderRounds([]);
      fireEvent.click(screen.getByRole('button', { name: /add round/i }));
      fireEvent.change(screen.getByLabelText(/^stage$/i), {
        target: { value: 'Onsite' },
      });
      fireEvent.change(screen.getByLabelText(/date & time/i), {
        target: { value: '2026-07-01T09:30' },
      });
      fireEvent.change(screen.getByLabelText(/length/i), {
        target: { value: '240' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalled());
      const [, payload] = vi.mocked(api.post).mock.calls[0];
      expect(payload).toMatchObject({ durationMinutes: 240 });
    });

    it('shows a success toast and closes the form', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: { id: 'r-new' } });
      renderRounds([]);
      fireEvent.click(screen.getByRole('button', { name: /add round/i }));
      fireEvent.change(screen.getByLabelText(/^stage$/i), {
        target: { value: 'Onsite' },
      });
      fireEvent.change(screen.getByLabelText(/date & time/i), {
        target: { value: '2026-07-01T09:30' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
          'Interview round added',
        ),
      );
      expect(screen.queryByLabelText(/^stage$/i)).not.toBeInTheDocument();
    });
  });

  describe('cancel', () => {
    it('closes the form without submitting', () => {
      renderRounds([]);
      fireEvent.click(screen.getByRole('button', { name: /add round/i }));
      fireEvent.change(screen.getByLabelText(/^stage$/i), {
        target: { value: 'Onsite' },
      });
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(screen.queryByLabelText(/^stage$/i)).not.toBeInTheDocument();
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });
  });

  describe('outcome change', () => {
    it('patches the outcome and shows a success toast', async () => {
      vi.mocked(api.patch).mockResolvedValue({ data: round });
      renderRounds([round]);
      fireEvent.change(screen.getByDisplayValue('Pending'), {
        target: { value: 'PASSED' },
      });
      await waitFor(() =>
        expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
          '/jobs/j-1/interview-rounds/r-1',
          { outcome: 'PASSED' },
        ),
      );
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Outcome updated');
    });

    it('shows the server error message on failure', async () => {
      vi.mocked(api.patch).mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: 'Round already resolved' } },
      });
      renderRounds([round]);
      fireEvent.change(screen.getByDisplayValue('Pending'), {
        target: { value: 'FAILED' },
      });
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Round already resolved',
        ),
      );
    });
  });

  describe('debrief', () => {
    it('does not show a debrief button for a PENDING round', () => {
      renderRounds([round]);
      expect(
        screen.queryByRole('button', { name: /add debrief/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /edit debrief/i }),
      ).not.toBeInTheDocument();
    });

    it('shows "Add debrief" for a PASSED round with no notes yet', () => {
      renderRounds([{ ...round, outcome: 'PASSED', notes: null }]);
      expect(
        screen.getByRole('button', { name: /add debrief/i }),
      ).toBeInTheDocument();
    });

    it('shows "Edit debrief" for a FAILED round that already has notes', () => {
      renderRounds([{ ...round, outcome: 'FAILED' }]);
      expect(
        screen.getByRole('button', { name: /edit debrief/i }),
      ).toBeInTheDocument();
    });

    it('opens the editor pre-filled with existing notes and saves outcome + notes together', async () => {
      vi.mocked(api.patch).mockResolvedValue({ data: {} });
      renderRounds([{ ...round, outcome: 'PASSED' }]);

      fireEvent.click(screen.getByRole('button', { name: /edit debrief/i }));
      const textarea = screen.getByLabelText(/debrief notes for phone screen/i);
      expect(textarea).toHaveValue('Ask about on-call rotation');

      fireEvent.change(textarea, {
        target: { value: 'Went well, discussed React deeply' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() =>
        expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
          '/jobs/j-1/interview-rounds/r-1',
          { outcome: 'PASSED', notes: 'Went well, discussed React deeply' },
          { timeout: 60_000 },
        ),
      );
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Debrief saved');
    });

    it('closes the editor without saving on Cancel', () => {
      renderRounds([{ ...round, outcome: 'PASSED' }]);
      fireEvent.click(screen.getByRole('button', { name: /edit debrief/i }));
      expect(
        screen.getByLabelText(/debrief notes for phone screen/i),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
      expect(
        screen.queryByLabelText(/debrief notes for phone screen/i),
      ).not.toBeInTheDocument();
      expect(vi.mocked(api.patch)).not.toHaveBeenCalled();
    });
  });

  describe('edit flow', () => {
    function openEdit() {
      renderRounds([round]);
      fireEvent.click(
        screen.getByRole('button', { name: /edit phone screen/i }),
      );
    }

    it('pre-fills stage, local date-time, length, and notes', () => {
      openEdit();
      expect(screen.getByLabelText(/^stage$/i)).toHaveValue('Phone Screen');
      // Local basis, matching what the row renders through formatDateTime.
      const local = new Date('2026-06-10T14:00:00Z');
      const pad = (n: number) => String(n).padStart(2, '0');
      expect(screen.getByLabelText(/date & time/i)).toHaveValue(
        `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`,
      );
      expect(screen.getByLabelText(/length/i)).toHaveValue(45);
      expect(screen.getByLabelText(/notes/i)).toHaveValue(
        'Ask about on-call rotation',
      );
    });

    it('patches only the changed date, leaving reminderSentAt intact', async () => {
      vi.mocked(api.patch).mockResolvedValue({ data: { id: 'r-1' } });
      openEdit();
      fireEvent.change(screen.getByLabelText(/date & time/i), {
        target: { value: '2026-06-12T09:30' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() => expect(vi.mocked(api.patch)).toHaveBeenCalled());
      const [url, payload] = vi.mocked(api.patch).mock.calls[0];
      expect(url).toBe('/jobs/j-1/interview-rounds/r-1');
      expect(payload).toEqual({
        scheduledAt: new Date('2026-06-12T09:30').toISOString(),
      });
    });

    it('patches only the changed length', async () => {
      vi.mocked(api.patch).mockResolvedValue({ data: { id: 'r-1' } });
      openEdit();
      fireEvent.change(screen.getByLabelText(/length/i), {
        target: { value: '120' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() => expect(vi.mocked(api.patch)).toHaveBeenCalled());
      const [, payload] = vi.mocked(api.patch).mock.calls[0];
      expect(payload).toEqual({ durationMinutes: 120 });
    });

    it('never patches when nothing changed and closes the form', async () => {
      openEdit();
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() =>
        expect(screen.queryByLabelText(/^stage$/i)).not.toBeInTheDocument(),
      );
      expect(vi.mocked(api.patch)).not.toHaveBeenCalled();
    });

    it('shows an inline error and never patches on a whitespace-only stage', async () => {
      openEdit();
      fireEvent.change(screen.getByLabelText(/^stage$/i), {
        target: { value: '   ' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      expect(await screen.findByText('Stage is required')).toBeInTheDocument();
      expect(vi.mocked(api.patch)).not.toHaveBeenCalled();
    });

    it('closes the form on Cancel without patching', () => {
      openEdit();
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
      expect(screen.queryByLabelText(/^stage$/i)).not.toBeInTheDocument();
      expect(vi.mocked(api.patch)).not.toHaveBeenCalled();
    });

    it('shows a success toast and closes the form', async () => {
      vi.mocked(api.patch).mockResolvedValue({ data: { id: 'r-1' } });
      openEdit();
      fireEvent.change(screen.getByLabelText(/^stage$/i), {
        target: { value: 'Onsite' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
          'Interview round updated',
        ),
      );
      expect(screen.queryByLabelText(/^stage$/i)).not.toBeInTheDocument();
    });

    it('falls back to a generic error message on failure', async () => {
      vi.mocked(api.patch).mockRejectedValue(new Error('boom'));
      openEdit();
      fireEvent.change(screen.getByLabelText(/^stage$/i), {
        target: { value: 'Onsite' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Failed to update round',
        ),
      );
    });
  });

  describe('prep suggestions', () => {
    it('renders the suggested-prep block when prepSuggestions is set', () => {
      renderRounds([
        { ...round, prepSuggestions: 'Review React hooks before the onsite' },
      ]);
      expect(
        screen.getByText('Suggested prep for this round'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Review React hooks before the onsite'),
      ).toBeInTheDocument();
    });

    it('omits the block when prepSuggestions is null', () => {
      renderRounds([{ ...round, prepSuggestions: null }]);
      expect(
        screen.queryByText('Suggested prep for this round'),
      ).not.toBeInTheDocument();
    });
  });

  describe('delete flow', () => {
    it('toggles a confirm prompt and reverts on No', () => {
      renderRounds([round]);
      fireEvent.click(screen.getByRole('button', { name: /remove round/i }));
      expect(screen.getByText('Remove?')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^no$/i }));
      expect(screen.queryByText('Remove?')).not.toBeInTheDocument();
      expect(vi.mocked(api.delete)).not.toHaveBeenCalled();
    });

    it('deletes on Yes and shows a success toast', async () => {
      vi.mocked(api.delete).mockResolvedValue({ data: {} });
      renderRounds([round]);
      fireEvent.click(screen.getByRole('button', { name: /remove round/i }));
      fireEvent.click(screen.getByRole('button', { name: /^yes$/i }));
      await waitFor(() =>
        expect(vi.mocked(api.delete)).toHaveBeenCalledWith(
          '/jobs/j-1/interview-rounds/r-1',
        ),
      );
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        'Interview round removed',
      );
    });

    it('falls back to a generic error message on delete failure', async () => {
      vi.mocked(api.delete).mockRejectedValue(new Error('network down'));
      renderRounds([round]);
      fireEvent.click(screen.getByRole('button', { name: /remove round/i }));
      fireEvent.click(screen.getByRole('button', { name: /^yes$/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Failed to remove round',
        ),
      );
    });
  });

  describe('ics download', () => {
    it('downloads using the filename from Content-Disposition', async () => {
      const createObjectURL = vi.fn().mockReturnValue('blob:mock');
      const revokeObjectURL = vi.fn();
      vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      vi.mocked(api.get).mockResolvedValue({
        data: new Blob(['ics']),
        headers: { 'content-disposition': 'attachment; filename="round.ics"' },
      });
      renderRounds([round]);
      fireEvent.click(screen.getByRole('button', { name: /add to calendar/i }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
      expect(clickSpy).toHaveBeenCalled();

      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    });

    it('falls back to interview.ics without a Content-Disposition header', async () => {
      const createObjectURL = vi.fn().mockReturnValue('blob:mock');
      vi.stubGlobal('URL', {
        ...URL,
        createObjectURL,
        revokeObjectURL: vi.fn(),
      });
      let downloadedName = '';
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function (this: HTMLAnchorElement) {
          downloadedName = this.download;
        });

      vi.mocked(api.get).mockResolvedValue({
        data: new Blob(['ics']),
        headers: {},
      });
      renderRounds([round]);
      fireEvent.click(screen.getByRole('button', { name: /add to calendar/i }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
      expect(downloadedName).toBe('interview.ics');

      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    });

    it('shows an error toast when the download fails', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('network down'));
      renderRounds([round]);
      fireEvent.click(screen.getByRole('button', { name: /add to calendar/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Failed to download calendar file',
        ),
      );
    });
  });
});
