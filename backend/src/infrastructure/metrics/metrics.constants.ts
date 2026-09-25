/** The only path the metrics listener serves (ADR-052). */
export const METRICS_PATH = '/metrics';

/**
 * Request-duration buckets, in seconds. Eight, not the client's default
 * eleven: every bucket is one more series per route, method and status
 * class, and the free Grafana Cloud tier caps active series. The few
 * LLM-backed calls that run past 10 s (Quick Add, round prep) land in `+Inf`.
 */
export const HTTP_DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/** Label for a request that matched no route (404s, probes, scanners). */
export const UNMATCHED_ROUTE = 'unmatched';
