# ADR-001: Use Tavily as the Web Search Provider for Company Enrichment

## Status
Accepted

## Date
2026-06-13

## Context
The company enrichment pipeline (`EnrichmentModule`) fetches web snippets about a company's culture and tech stack to give the LLM richer context before extracting structured data. This requires a third-party search API.

The original implementation used **Brave Search API**, which was chosen for its generous free tier (2,000 req/month) and privacy-first positioning. However, Brave Search API became inaccessible (geo-restricted or temporarily unavailable) in the deployment region, making it impossible to obtain an API key.

Requirements for a replacement:
- Free tier with no credit card required
- Suitable for LLM/AI use cases (clean, dense content snippets rather than HTML)
- Simple REST API
- Reliable availability

## Decision
Replace Brave Search with **Tavily** (`api.tavily.com`).

## Alternatives Considered

### Brave Search API
- Pros: Privacy-first, 2,000 free req/month
- Cons: API access was unavailable in the target region
- Rejected: Cannot obtain API key

### Google Custom Search API
- Pros: Reliable, widely used
- Cons: Free tier limited to 100 queries/day; requires Google Cloud project setup
- Rejected: Too low a free-tier limit for meaningful use

### SerpAPI
- Pros: Supports multiple search engines
- Cons: Free tier only 100 searches/month; paid plans start at $50/month
- Rejected: Too restrictive for a portfolio project

### DuckDuckGo (scraping)
- Pros: No API key needed
- Cons: No official API; scraping violates ToS and is fragile
- Rejected: Unreliable and unsustainable

### Tavily
- Pros: Built specifically for AI/LLM use cases, returns clean `content` snippets; 1,000 free req/month; no credit card required; simple POST API
- Cons: Newer, smaller provider than Google
- Accepted

## Consequences
- `BRAVE_SEARCH_API_KEY` env var renamed to `TAVILY_API_KEY` across all config, docs, and `.env.example`
- Request shape changed: GET with query params → POST with JSON body
- Response shape changed: `web.results[].description` → `results[].content`
- `SearchService` updated; unit tests rewritten for new response shape
- Enrichment still degrades gracefully (returns `[]`) when `TAVILY_API_KEY` is not set, so the app starts without it
- Free tier: 1,000 req/month at `app.tavily.com`
