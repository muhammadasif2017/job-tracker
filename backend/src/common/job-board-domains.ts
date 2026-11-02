/**
 * Hosts that are job boards or applicant-tracking systems, not a company's
 * own site — their domain must not be used as a trust hint or for
 * official-site fetching. Matched on the host and every subdomain of it, so
 * `boards.greenhouse.io` and `acme.wd5.myworkdayjobs.com` are covered by
 * their base entries. An ATS page describes one opening, or the ATS vendor
 * itself, never the employer's industry or size.
 */
export const JOB_BOARD_DOMAINS = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'rozee.pk',
  'bayt.com',
  'monster.com',
  'ziprecruiter.com',
  'wellfound.com',
  // Applicant-tracking systems
  'greenhouse.io',
  'lever.co',
  'myworkdayjobs.com',
  'ashbyhq.com',
  'smartrecruiters.com',
  'workable.com',
  'bamboohr.com',
  'breezy.hr',
  'recruitee.com',
  'jobvite.com',
  'icims.com',
  'teamtailor.com',
];
