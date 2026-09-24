// Shared by background.js (via importScripts) and popup.js (via <script> tag).
const DEFAULT_BACKEND_URL = 'http://localhost:3001';
const STORAGE_KEY = 'jobTrackerConnection';
// Every API call goes to the versioned routes (backend ADR-047). The stored
// backendUrl stays the bare origin, so a saved connection keeps working.
const API_PREFIX = '/v1';
// Access tokens are 15 min server-side (JWT_EXPIRES_IN) - refresh a little
// early so a request never races an about-to-expire token.
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 30_000;
