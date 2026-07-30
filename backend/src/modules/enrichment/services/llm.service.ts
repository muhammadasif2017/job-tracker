import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { Logger } from 'nestjs-pino';

export interface CompanyData {
  industry: string;
  companySize: string;
  techStack: string[];
  cultureSummary: string;
  workPolicy: string;
  workLifeBalance: string;
  headquarters: string;
  address: string;
  founded: string;
}

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
        techStack: { type: 'array', items: { type: 'string' } },
        cultureSummary: {
          type: 'string',
          description: '2-3 sentences about work culture',
        },
        workPolicy: {
          type: 'string',
          enum: ['Remote', 'Hybrid', 'On-site', 'Unknown'],
        },
        workLifeBalance: {
          type: 'string',
          enum: ['Excellent', 'Good', 'Average', 'Below Average', 'Unknown'],
        },
        headquarters: { type: 'string' },
        address: {
          type: 'string',
          description:
            'Full postal/street address of the company office. Extract ONLY from ' +
            'the OFFICIAL COMPANY WEBSITE section of the content; if no address ' +
            'appears there, use "Unknown". Never take an address from web search ' +
            'results — they may belong to a different company with a similar name.',
        },
        founded: { type: 'string' },
      },
      required: [
        'industry',
        'companySize',
        'techStack',
        'cultureSummary',
        'workPolicy',
        'workLifeBalance',
        'headquarters',
        'address',
        'founded',
      ],
    },
  },
};

export interface ParsedJobData {
  company?: string;
  position?: string;
  location?: string;
  jobType?: 'ONSITE' | 'HYBRID' | 'REMOTE';
}

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

function str(val: unknown): string {
  return typeof val === 'string' && val.trim() ? val.trim() : 'Unknown';
}

function optStr(val: unknown): string | undefined {
  const s = str(val);
  return s === 'Unknown' ? undefined : s;
}

function sanitizeJobPosting(raw: Record<string, unknown>): ParsedJobData {
  const jobType =
    raw.jobType === 'ONSITE' ||
    raw.jobType === 'HYBRID' ||
    raw.jobType === 'REMOTE'
      ? raw.jobType
      : undefined;
  return {
    company: optStr(raw.company),
    position: optStr(raw.position),
    location: optStr(raw.location),
    jobType,
  };
}

function sanitize(raw: Record<string, unknown>): CompanyData {
  return {
    industry: str(raw.industry),
    companySize: str(raw.companySize),
    techStack: Array.isArray(raw.techStack)
      ? raw.techStack.filter(
          (t): t is string => typeof t === 'string' && !!t.trim(),
        )
      : [],
    cultureSummary: str(raw.cultureSummary),
    workPolicy: str(raw.workPolicy),
    workLifeBalance: str(raw.workLifeBalance),
    headquarters: str(raw.headquarters),
    address: str(raw.address),
    founded: str(raw.founded),
  };
}

@Injectable()
export class LlmService {
  private readonly client: Groq;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {
    this.client = new Groq({
      apiKey: this.config.get('GROQ_API_KEY') ?? 'placeholder',
    });
  }

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
            `unrelated companies that merely share the same name. In particular, extract ` +
            `the address and other contact details only from snippets sourced from this ` +
            `domain or that unambiguously describe "${companyName}".`,
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

      const response = await this.client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
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
              `If information is not available in the provided content, use "Unknown" for ` +
              `string fields and [] for arrays. Do not guess or hallucinate data not present ` +
              `in the content. If the content describes a different company that merely ` +
              `shares the name "${companyName}", return "Unknown" for all string fields ` +
              `and [] for arrays rather than extracting from it.` +
              `${disambiguationBlock}\n\nWeb content:\n${context}`,
          },
        ],
      });

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

  async extractJobPosting(content: string): Promise<ParsedJobData> {
    try {
      const response = await this.client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
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
      });

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
}
