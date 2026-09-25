import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// A full local run starts 73 jsdom environments at once, and a starved worker
// can take over a second to render a page. Testing Library's default 1000 ms
// `waitFor` budget then fails tests that have no bug (seen on the dashboard
// page test). A passing `waitFor` returns as soon as its check holds, so this
// only gives a slow run more room; it doesn't slow the suite down.
configure({ asyncUtilTimeout: 3000 });
