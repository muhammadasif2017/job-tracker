# Job Tracker (browser extension)

Imports the job posting in your current tab into Job Tracker via the
existing `/jobs/parse` quick-add endpoint. Not published to a store — load
it unpacked for personal use.

## Install (Chrome/Edge)

1. Go to `chrome://extensions`, enable Developer mode.
2. Click "Load unpacked" and select this folder.

## Connect

1. In the Job Tracker web app, go to Profile → Personal access tokens →
   Generate token. Copy the raw token (shown once).
2. Open the extension popup, enter your backend URL (e.g.
   `http://localhost:3001` for local dev) and paste the token, then Connect.

## Use

On any job posting page, open the popup and click "Import this job". Review
the parsed fields, edit if needed, and add it to Job Tracker.
