// Technology names that appear in job titles, matched against the `position`
// of jobs the user tracked at a company (see ADR-042). Deliberately small and
// title-shaped: these are the words that actually show up in a title, not a
// general technology taxonomy. A stack entry that only ever appears in a job
// *description* is out of reach — this app stores no description.
//
// Why a list at all: three prompt revisions failed to make the model take
// "Senior React Developer" as evidence that a company works with React, the
// same instruction-following ceiling ADR-013 hit with `address`. A lookup is
// deterministic and cheap where a prompt was neither.
export const TECH_TOKENS = [
  '.NET',
  'Android',
  'Angular',
  'AWS',
  'Azure',
  'C#',
  'C++',
  'Django',
  'Docker',
  'Elixir',
  'Flutter',
  'Go',
  'GraphQL',
  'Java',
  'JavaScript',
  'Kotlin',
  'Kubernetes',
  'Laravel',
  'MERN',
  'MongoDB',
  'MySQL',
  'Next.js',
  'Node.js',
  'PHP',
  'PostgreSQL',
  'Python',
  'React',
  'React Native',
  'Ruby on Rails',
  'Rust',
  'Salesforce',
  'Scala',
  'Spring Boot',
  'SQL',
  'Swift',
  'Symfony',
  'Terraform',
  'TypeScript',
  'Vue',
  'WordPress',
] as const;

// Word-boundary matching, case-insensitive, on a per-token regex built once.
// `\b` alone breaks on the punctuation these names carry (".NET", "C++",
// "Node.js"), so the token is escaped and bounded by "not a word character"
// lookarounds instead.
const TOKEN_PATTERNS: { token: string; pattern: RegExp }[] = TECH_TOKENS.map(
  (token) => ({
    token,
    pattern: new RegExp(
      `(?<![A-Za-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`,
      'i',
    ),
  }),
);

// A token is redundant when a longer token matched in the SAME title contains
// it as a whole word: "React Native Engineer" names React Native, not React
// and React Native. Scoped per title on purpose - a company tracking both a
// "React Developer" and a "React Native Engineer" genuinely uses both, and a
// global filter would erase the plain React the first title established.
function dropContained(matched: string[]): string[] {
  return matched.filter(
    (token) =>
      !matched.some(
        (other) =>
          other !== token &&
          TOKEN_PATTERNS.find((p) => p.token === token)?.pattern.test(other),
      ),
  );
}

/** Technology names mentioned in any of the given job titles, deduped. */
export function techFromJobTitles(titles: string[]): string[] {
  const found = new Set<string>();
  for (const title of titles) {
    const matched = TOKEN_PATTERNS.filter(({ pattern }) =>
      pattern.test(title),
    ).map(({ token }) => token);
    for (const token of dropContained(matched)) found.add(token);
  }
  return [...found];
}
