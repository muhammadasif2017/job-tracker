import type { AttentionType } from '../jobs/dto/attention-item.dto.js';

interface EmailContent {
  subject: string;
  html: string;
}

// company/position/stage come from free-text fields (including LLM extraction
// of external job postings via POST /jobs/parse) — never trust them raw in HTML.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const settingsLink = (frontendUrl: string) =>
  `<p><a href="${frontendUrl}/profile">Manage notification settings</a></p>`;

export function interviewReminderEmail(input: {
  company: string;
  position: string;
  stage: string;
  scheduledAt: Date;
  frontendUrl: string;
}): EmailContent {
  const when = input.scheduledAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const company = escapeHtml(input.company);
  const position = escapeHtml(input.position);
  const stage = escapeHtml(input.stage);
  return {
    subject: `Reminder: ${input.stage} interview at ${input.company} tomorrow`,
    html: `
      <p>Heads up — you have an interview coming up:</p>
      <p><strong>${company}</strong> — ${position}<br/>
      Round: ${stage}<br/>
      When: ${when}</p>
      ${settingsLink(input.frontendUrl)}
    `,
  };
}

export interface AttentionItemForEmail {
  type: AttentionType;
  company: string;
  position: string;
  since: Date;
}

const ATTENTION_LABELS: Record<AttentionType, string> = {
  UPCOMING_INTERVIEW: 'Interview coming up',
  STALE_INTERVIEWING: 'No update in 5+ days',
  STALE_APPLIED: 'No response in 7+ days',
};

export function digestEmail(input: {
  items: AttentionItemForEmail[];
  frontendUrl: string;
}): EmailContent {
  const rows = input.items
    .map(
      (item) =>
        `<li>${ATTENTION_LABELS[item.type]}: <strong>${escapeHtml(item.company)}</strong> — ${escapeHtml(item.position)}</li>`,
    )
    .join('');
  const count = input.items.length;
  return {
    subject: `Job search digest: ${count} item${count === 1 ? '' : 's'} need attention`,
    html: `
      <p>Here's what needs your attention:</p>
      <ul>${rows}</ul>
      ${settingsLink(input.frontendUrl)}
    `,
  };
}
