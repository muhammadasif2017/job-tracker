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

  it('escapes HTML in company, position and stage', () => {
    const { html } = interviewReminderEmail({
      company: 'Acme<a href="http://evil.example">click</a>',
      position: '<script>alert(1)</script>',
      stage: 'Screen & Chat',
      scheduledAt: new Date('2026-08-05T10:00:00Z'),
      frontendUrl: 'http://localhost:3000',
    });

    expect(html).not.toContain('<a href="http://evil.example">');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;a href=&quot;http://evil.example&quot;&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Screen &amp; Chat');
  });

  it('strips CR/LF from company and stage before building the subject (header injection)', () => {
    // A literal CR/LF in the subject could inject extra email headers
    // (e.g. an attacker-controlled company name ending in "\r\nBcc: ...")
    // depending on how far upstream (Resend) sanitizes before sending.
    const { subject } = interviewReminderEmail({
      company: 'Acme\r\nBcc: attacker@evil.example',
      position: 'Senior Engineer',
      stage: 'Technical\r\nScreen',
      scheduledAt: new Date('2026-08-05T10:00:00Z'),
      frontendUrl: 'http://localhost:3000',
    });

    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('renders the interview time in UTC, explicitly labelled, and does not claim it is tomorrow', () => {
    const { subject, html } = interviewReminderEmail({
      company: 'Acme',
      position: 'Senior Engineer',
      stage: 'Technical Screen',
      scheduledAt: new Date('2026-08-05T10:00:00Z'),
      frontendUrl: 'http://localhost:3000',
    });

    expect(html).toContain('UTC');
    expect(subject).not.toContain('tomorrow');
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

  it('escapes HTML in item company and position', () => {
    const { html } = digestEmail({
      items: [
        {
          type: 'STALE_APPLIED',
          company: '<img src=x onerror=alert(1)>',
          position: 'Eng & Ops',
          since: new Date('2026-07-01T00:00:00Z'),
        },
      ],
      frontendUrl: 'http://localhost:3000',
    });

    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Eng &amp; Ops');
  });
});
