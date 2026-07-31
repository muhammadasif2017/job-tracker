import { interviewReminderEmail, digestEmail } from './templates.js';

describe('interviewReminderEmail', () => {
  it('includes company, position, stage and a settings link', () => {
    const { subject, html } = interviewReminderEmail({
      company: 'Acme',
      position: 'Senior Engineer',
      stage: 'Technical Screen',
      scheduledAt: new Date('2026-08-05T10:00:00Z'),
      frontendUrl: 'http://localhost:3000',
    });

    expect(subject).toContain('Acme');
    expect(html).toContain('Acme');
    expect(html).toContain('Senior Engineer');
    expect(html).toContain('Technical Screen');
    expect(html).toContain('http://localhost:3000/profile');
  });
});

describe('digestEmail', () => {
  it('lists each attention item and includes a settings link', () => {
    const { subject, html } = digestEmail({
      items: [
        {
          type: 'STALE_APPLIED',
          company: 'Acme',
          position: 'Engineer',
          since: new Date('2026-07-01T00:00:00Z'),
        },
        {
          type: 'UPCOMING_INTERVIEW',
          company: 'Globex',
          position: 'Manager',
          since: new Date('2026-08-02T00:00:00Z'),
        },
      ],
      frontendUrl: 'http://localhost:3000',
    });

    expect(subject).toContain('2');
    expect(html).toContain('Acme');
    expect(html).toContain('Globex');
    expect(html).toContain('http://localhost:3000/profile');
  });
});
