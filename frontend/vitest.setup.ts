import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// A full local run keeps every Vitest worker busy building jsdom environments,
// and a starved worker can take over a second to render a page. Testing
// Library's default 1000 ms `waitFor` budget then fails tests that have no bug
// (seen on the dashboard page test). A passing `waitFor` still returns as soon
// as its check holds. The cost: a failing `waitFor` or `findBy*` now takes 3 s,
// not 1 s, to report.
configure({ asyncUtilTimeout: 3000 });
