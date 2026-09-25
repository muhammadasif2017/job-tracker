import { Injectable } from '@nestjs/common';
import { BusinessMode } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { Logger } from 'nestjs-pino';
import {
  CircuitBreaker,
  type CircuitStatus,
} from '../../../infrastructure/resilience/circuit-breaker.js';

/**
 * What one enrichment run yields about a company. Every field is nullable
 * because the model is asked to return nothing rather than guess, and a
 * null here clears a stale value when it is written over an earlier run.
 */
export interface CompanyData {
  industry: string | null;
  companySize: string | null;
  techStack: string[];
  cultureSummary: string | null;
  productDescription: string | null;
  businessMode: BusinessMode | null;
}

/**
 * The tool schema the model fills in for company enrichment. Using a tool
 * call rather than free prose is what makes the output parseable at all —
 * the enum on `companySize` in particular keeps the answer to one of the
 * buckets the UI can render.
 */
const EXTRACT_TOOL: Groq.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'extract_company_data',
    description: 'Extract structured company information from web content',
    parameters: {
      type: 'object',
      properties: {
        industry: { type: 'string' },
        companySize: {
          type: 'string',
          enum: [
            'Startup (<50)',
            'Small (50-200)',
            'Mid-size (200-1000)',
            'Large (1000-5000)',
            'Enterprise (5000+)',
            'Unknown',
          ],
        },
        techStack: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Programming languages, frameworks, databases, and cloud platforms ' +
            'the company builds its products with. Not website infrastructure.',
        },
        cultureSummary: {
          type: 'string',
          description: '2-3 sentences about work culture',
        },
        productDescription: {
          type: 'string',
          description:
            '1-2 sentences on what the company actually builds or sells - its ' +
            'products, or the services it delivers to clients',
        },
        businessMode: {
          type: 'string',
          description:
            'PRODUCT if it sells its own products, SERVICES if it delivers ' +
            'client projects or staff augmentation, HYBRID if it does both',
          enum: ['PRODUCT', 'SERVICES', 'HYBRID', 'Unknown'],
        },
      },
      // `cultureSummary` and `productDescription` are intentionally absent:
      // they are the free-prose fields here, and forcing them makes the model
      // invent claims for companies with no public write-up. Optional lets it
      // return nothing.
      required: ['industry', 'companySize', 'techStack', 'businessMode'],
    },
  },
};

/**
 * What Quick Add gets out of a pasted job posting. Null means the posting
 * did not say, which the form leaves for the user to fill in.
 */
export interface ParsedJobData {
  company?: string | null;
  position?: string | null;
  location?: string | null;
  jobType?: 'ONSITE' | 'HYBRID' | 'REMOTE';
}

/**
 * The tool schema for parsing a job posting, kept separate from
 * `EXTRACT_TOOL` because the two prompts extract different things from
 * different source text.
 */
const JOB_POSTING_TOOL: Groq.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'extract_job_posting',
    description:
      'Extract structured job application data from a job posting or job description',
    parameters: {
      type: 'object',
      properties: {
        company: { type: 'string' },
        position: { type: 'string', description: 'The job title' },
        location: { type: 'string' },
        jobType: {
          type: 'string',
          enum: ['ONSITE', 'HYBRID', 'REMOTE', 'Unknown'],
        },
      },
      required: ['company', 'position', 'location', 'jobType'],
    },
  },
};

/**
 * Coerces one model-supplied value to a trimmed string, falling back to
 * "Unknown". Everything arriving from a tool call is untrusted JSON, so
 * nothing is used at its declared type without passing through here.
 */
function str(val: unknown): string {
  return typeof val === 'string' && val.trim() ? val.trim() : 'Unknown';
}

/**
 * Both company-profile and job-posting fields are Prisma-nullable and can
 * be written by spreading the whole object onto an existing row (see
 * `CompanyEnrichmentProcessor.buildCompletedProfileData`) — an explicit
 * null clears a stale value on re-write, whereas undefined would omit the
 * key and leave the old value in place.
 */
function strOrNull(val: unknown): string | null {
  const s = str(val);
  return s === 'Unknown' ? null : s;
}

/**
 * Narrows a raw job-posting tool call to the typed shape. An off-enum
 * `jobType` becomes undefined rather than being passed along, so a bad
 * generation leaves the field unset instead of reaching validation.
 */
function sanitizeJobPosting(raw: Record<string, unknown>): ParsedJobData {
  const jobType =
    raw.jobType === 'ONSITE' ||
    raw.jobType === 'HYBRID' ||
    raw.jobType === 'REMOTE'
      ? raw.jobType
      : undefined;
  return {
    company: strOrNull(raw.company),
    position: strOrNull(raw.position),
    location: strOrNull(raw.location),
    jobType,
  };
}

/**
 * Whether a Groq error means Groq itself is unhealthy, for the circuit
 * breaker. No HTTP status (a connection failure or a client-side timeout),
 * a 429 and any 5xx count. Other 4xx do not: Groq answered, and the request
 * or the generation was at fault — `tool_use_failed` is a 400.
 */
export function isGroqOutage(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return true;
  return status === 429 || status >= 500;
}

/** Consecutive Groq outages that open the circuit (ADR-048). */
export const GROQ_FAILURE_THRESHOLD = 3;
/** How long the Groq circuit stays open before one trial call. */
export const GROQ_RESET_TIMEOUT_MS = 30_000;
/**
 * Breaker-level deadline on the half-open trial. The SDK's 45s timeout does
 * not cover the whole call: it is cleared once response headers arrive, so a
 * stalled body, or a long 429 `retry-after` it sleeps through, could hold the
 * trial, and with it every other Groq call, for minutes.
 */
export const GROQ_TRIAL_TIMEOUT_MS = 60_000;

/**
 * Groq's structured-output generation occasionally produces a tool call
 * that fails its own schema validation (400, code `tool_use_failed`) — a
 * generation-time glitch, not a bad request. Duck-typed rather than
 * `instanceof Groq.APIError` so it works whether the SDK's real error class
 * or a test double is thrown.
 */
function isToolUseFailedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; error?: { error?: { code?: string } } };
  return e.status === 400 && e.error?.error?.code === 'tool_use_failed';
}

/**
 * `businessMode` is the only extracted field Prisma types as an enum rather
 * than a string, so an off-enum generation would reach the database as an
 * invalid value instead of merely reading oddly. Checked against the enum
 * itself rather than a copied literal list.
 */
function businessModeOrNull(val: unknown): BusinessMode | null {
  const s = strOrNull(val);
  return s !== null && s in BusinessMode ? (s as BusinessMode) : null;
}

/**
 * Narrows a raw company tool call to `CompanyData`. `techStack` is filtered
 * element by element, since the model occasionally returns a mixed array.
 */
function sanitize(raw: Record<string, unknown>): CompanyData {
  return {
    industry: strOrNull(raw.industry),
    companySize: strOrNull(raw.companySize),
    techStack: Array.isArray(raw.techStack)
      ? raw.techStack.filter(
          (t): t is string => typeof t === 'string' && !!t.trim(),
        )
      : [],
    cultureSummary: strOrNull(raw.cultureSummary),
    productDescription: strOrNull(raw.productDescription),
    businessMode: businessModeOrNull(raw.businessMode),
  };
}

/**
 * Every Groq call the app makes. Two shapes live here: tool-call
 * extractions, whose output is parsed into typed fields, and free-text
 * completions, whose output is shown to the user as prose.
 */
@Injectable()
export class LlmService {
  private readonly client: Groq;
  /**
   * Wraps every Groq call. Without it, a Groq outage cost each caller the
   * full SDK budget (45s, retried once) before failing. Open, it fails them
   * at once; every caller already treats a failed call as best-effort.
   */
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {
    this.client = new Groq({
      apiKey: this.config.get('GROQ_API_KEY') ?? 'placeholder',
      // Hard upper bound on each call so a hung request can't keep a BullMQ
      // job running indefinitely. A client-side timeout is itself retried by
      // the SDK (groq-sdk/client.js) up to `maxRetries`, so pinning it here
      // (rather than the SDK default of 2) keeps one SDK call's worst case
      // closed-form: 45s * 2 = 90s. createWithRetry can add one more call on
      // a tool_use_failed. This is not sized to the workers' 90s
      // lockDuration: BullMQ renews a lock while the processor is running,
      // so that value is stall detection, not a runtime ceiling (see
      // docs/company-profile-enrichment.md §3). 45s (up from 30s) gives a
      // slow-but-healthy response more room before the first attempt aborts.
      timeout: 45_000,
      maxRetries: 1,
    });
    this.breaker = new CircuitBreaker({
      name: 'Groq',
      failureThreshold: GROQ_FAILURE_THRESHOLD,
      resetTimeoutMs: GROQ_RESET_TIMEOUT_MS,
      trialTimeoutMs: GROQ_TRIAL_TIMEOUT_MS,
      isFailure: isGroqOutage,
      onStateChange: (from, to) =>
        to === 'open'
          ? this.logger.warn('llm_circuit_opened', { from })
          : this.logger.log('llm_circuit_state', { from, to }),
    });
  }

  /** The Groq circuit's current state, for the admin queues page. */
  circuitStatus(): CircuitStatus {
    return this.breaker.status();
  }

  /**
   * One immediate retry on a `tool_use_failed` generation glitch, before
   * falling through to the caller's own retry — a full queue re-attempt,
   * which re-runs search and fetch too, is expensive for what is often a
   * one-off malformed generation.
   */
  private async createWithRetry<T>(
    call: () => Promise<T>,
    model: string,
  ): Promise<T> {
    try {
      return await this.breaker.execute(call);
    } catch (err) {
      if (!isToolUseFailedError(err)) throw err;
      this.logger.warn('llm_tool_use_failed_retry', { model });
      return await this.breaker.execute(call);
    }
  }

  /**
   * Extracts a company profile from gathered web content. The
   * disambiguation hints matter more than they look: company names collide
   * constantly, and without them the model happily describes a same-named
   * firm on the other side of the world.
   */
  async extract(
    companyName: string,
    context: string,
    disambiguation?: { domain?: string; location?: string },
  ): Promise<CompanyData> {
    try {
      const hints: string[] = [];
      if (disambiguation?.domain) {
        hints.push(
          `The job posting's official domain is "${disambiguation.domain}". Only use ` +
            `content that refers to the company at this domain — ignore snippets about ` +
            `unrelated companies that merely share the same name.`,
        );
      }
      if (disambiguation?.location) {
        hints.push(
          `The job is located in "${disambiguation.location}" — prefer content consistent ` +
            `with a company operating in or near this location over same-named companies ` +
            `elsewhere.`,
        );
      }
      const disambiguationBlock = hints.length ? `\n\n${hints.join('\n')}` : '';

      const response = await this.createWithRetry(
        () =>
          this.client.chat.completions.create({
            model: 'openai/gpt-oss-120b',
            max_tokens: 2048,
            tools: [EXTRACT_TOOL],
            tool_choice: 'required',
            messages: [
              {
                role: 'user',
                content:
                  `You are helping a job applicant evaluate a company. Extract structured data ` +
                  `from the following web content about "${companyName}".\n\n` +
                  `The web content is split into sections. Content under "OFFICIAL COMPANY ` +
                  `WEBSITE" comes from the company's own domain and is authoritative. Content ` +
                  `under "WEB SEARCH RESULTS" may describe different companies with similar ` +
                  `names — each snippet there begins with its source title and domain in ` +
                  `brackets; use these to judge whether it is really about "${companyName}". ` +
                  `A snippet describing a different kind of business is about a different ` +
                  `company even if the name or city matches, so ignore it.\n\n` +
                  `For techStack, list only what the company engineers with - languages, ` +
                  `frameworks, databases, cloud platforms. Web-analytics, tag-manager, CDN, ` +
                  `font, emoji and markup-format names (for example Google Analytics, ` +
                  `Mixpanel, Microsoft Clarity, Cloudflare, Twemoji, JSON-LD, Webpack) ` +
                  `describe how a marketing site was assembled, not what the company ` +
                  `builds; third-party site scanners list those, so exclude them. Return [] ` +
                  `rather than a list of them.

` +
                  `If information is not available in the provided content, use "Unknown" for ` +
                  `string fields and [] for arrays. Do not guess or hallucinate data not present ` +
                  `in the content.\n\n` +
                  `Judge each snippet on its own. Ignoring a snippet about a same-named but ` +
                  `different company means skipping that snippet — not discarding the whole ` +
                  `extraction. Search results for a small company routinely contain a few ` +
                  `genuine snippets mixed in with several about unrelated same-named ` +
                  `businesses; extract every field you can from the ones that really are about ` +
                  `"${companyName}", and simply ignore the rest. Return "Unknown" for all ` +
                  `string fields and [] for arrays only when NONE of the content is about ` +
                  `"${companyName}".` +
                  `${disambiguationBlock}\n\nWeb content:\n${context}`,
              },
            ],
          }),
        'openai/gpt-oss-120b',
      );

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error('No tool call in Groq response');

      const raw = JSON.parse(toolCall.function.arguments) as Record<
        string,
        unknown
      >;
      return sanitize(raw);
    } catch (err) {
      this.logger.warn('llm_extract_failed', {
        company: companyName,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Parses a pasted job posting into the fields the Quick Add form
   * pre-fills. The prompt asks for "Unknown" over a guess, because a wrong
   * company name silently attaches the job to the wrong employer.
   */
  async extractJobPosting(content: string): Promise<ParsedJobData> {
    try {
      const response = await this.createWithRetry(
        () =>
          this.client.chat.completions.create({
            model: 'openai/gpt-oss-120b',
            max_tokens: 1024,
            tools: [JOB_POSTING_TOOL],
            tool_choice: 'required',
            messages: [
              {
                role: 'user',
                content:
                  `Extract the company name, job title, location, and work arrangement type ` +
                  `(ONSITE, HYBRID, or REMOTE) from the following job posting content. If a ` +
                  `field is not present in the content, use "Unknown". Do not guess or ` +
                  `hallucinate data not present in the content.\n\nJob posting content:\n${content}`,
              },
            ],
          }),
        'openai/gpt-oss-120b',
      );

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error('No tool call in Groq response');

      const raw = JSON.parse(toolCall.function.arguments) as Record<
        string,
        unknown
      >;
      return sanitizeJobPosting(raw);
    } catch (err) {
      this.logger.warn('llm_extract_job_posting_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Suggests talking points for a job's next interview round from the
   * debrief of the one just finished.
   *
   * A free-text completion with no tool schema — the output is prose, so
   * there is nothing for a tool call to extract, and the `tool_use_failed`
   * retry does not apply. Groq's own SDK-level retry still covers transient
   * network and 5xx failures.
   */
  async generateRoundPrep(input: {
    company: string;
    position: string;
    completedStage: string;
    completedNotes: string;
    nextStage: string;
  }): Promise<string> {
    try {
      const response = await this.breaker.execute(() =>
        this.client.chat.completions.create({
          model: 'openai/gpt-oss-120b',
          max_tokens: 512,
          messages: [
            {
              role: 'user',
              content:
                `A job applicant for "${input.position}" at "${input.company}" just finished ` +
                `the "${input.completedStage}" interview round and left these debrief notes:\n\n` +
                `${input.completedNotes}\n\n` +
                `Their next round is "${input.nextStage}". Based on the debrief notes, suggest ` +
                `3-5 concise talking points or questions to prepare for that next round. Plain ` +
                `text, short bullet points, no preamble.`,
            },
          ],
        }),
      );

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) throw new Error('Empty response from Groq');
      return content;
    } catch (err) {
      this.logger.warn('llm_generate_round_prep_failed', {
        company: input.company,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Writes the one-sentence caption shown on a job's timeline. Another
   * free-text completion, capped short because the output has to fit a
   * dashboard line.
   */
  async summarizeEvents(
    events: {
      type: string;
      fromStatus: string | null;
      toStatus: string;
      note: string | null;
      createdAt: Date;
    }[],
    context: { company: string; position: string },
  ): Promise<string> {
    try {
      const timeline = events
        .map((e) => {
          const parts = [e.createdAt.toISOString().slice(0, 10), e.type];
          if (e.fromStatus) parts.push(`${e.fromStatus} -> ${e.toStatus}`);
          else parts.push(e.toStatus);
          if (e.note) parts.push(`(${e.note})`);
          return parts.join(' ');
        })
        .join('\n');

      const response = await this.breaker.execute(() =>
        this.client.chat.completions.create({
          model: 'openai/gpt-oss-120b',
          max_tokens: 128,
          messages: [
            {
              role: 'user',
              content:
                `Here is the event timeline for a job application to "${context.company}" for ` +
                `the "${context.position}" position:\n\n${timeline}\n\n` +
                `Summarize what happened in ONE short plain-English sentence, suitable for a ` +
                `dashboard caption. No preamble, no quotes around the sentence.`,
            },
          ],
        }),
      );

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) throw new Error('Empty response from Groq');
      return content;
    } catch (err) {
      this.logger.warn('llm_summarize_events_failed', {
        company: context.company,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
