import type { AttentionType } from '../jobs/dto/attention-item.dto.js';

interface EmailContent {
  subject: string;
  html: string;
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
  return {
    subject: `Reminder: ${input.stage} interview at ${input.company} tomorrow`,
    html: `
      <p>Heads up — you have an interview coming up:</p>
      <p><strong>${input.company}</strong> — ${input.position}<br/>
      Round: ${input.stage}<br/>
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
        `<li>${ATTENTION_LABELS[item.type]}: <strong>${item.company}</strong> — ${item.position}</li>`,
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
