import { techFromJobTitles } from './tech-tokens.js';

describe('techFromJobTitles', () => {
  it('reads technologies out of job titles', () => {
    expect(
      techFromJobTitles(['Senior React Developer', 'Django Engineer']).sort(),
    ).toEqual(['Django', 'React']);
  });

  it('matches names carrying punctuation that a plain word boundary breaks on', () => {
    expect(techFromJobTitles(['.NET Core Developer'])).toContain('.NET');
    expect(techFromJobTitles(['Node.js Backend Engineer'])).toContain(
      'Node.js',
    );
    expect(techFromJobTitles(['C++ Systems Programmer'])).toContain('C++');
  });

  it('is case-insensitive but does not match inside a longer word', () => {
    expect(techFromJobTitles(['senior python developer'])).toEqual(['Python']);
    // "Gopher" must not match "Go", "Javascriptish" must not match "Java".
    expect(techFromJobTitles(['Gopher Wrangler'])).toEqual([]);
  });

  it('keeps only the longer name when one token contains another', () => {
    expect(techFromJobTitles(['React Native Engineer'])).toEqual([
      'React Native',
    ]);
  });

  it('keeps both when separate titles establish each independently', () => {
    expect(
      techFromJobTitles(['React Developer', 'React Native Engineer']).sort(),
    ).toEqual(['React', 'React Native']);
  });

  it('dedupes a technology named across several titles', () => {
    expect(
      techFromJobTitles(['React Developer', 'Senior React Engineer']),
    ).toEqual(['React']);
  });

  it('returns nothing for titles that name no technology', () => {
    expect(techFromJobTitles(['Project Manager', 'Business Analyst'])).toEqual(
      [],
    );
  });
});
