import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { Logger } from 'nestjs-pino';

export interface CompanyData {
  industry: string;
  companySize: string;
  techStack: string[];
  cultureSummary: string;
  remotePolicy: string;
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
        remotePolicy: {
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
            'Full postal/street address of the company office, if stated',
        },
        founded: { type: 'string' },
      },
      required: [
        'industry',
        'companySize',
        'techStack',
        'cultureSummary',
        'remotePolicy',
        'workLifeBalance',
        'headquarters',
        'address',
        'founded',
      ],
    },
  },
};

function str(val: unknown): string {
  return typeof val === 'string' && val.trim() ? val.trim() : 'Unknown';
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
    remotePolicy: str(raw.remotePolicy),
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
              `If information is not available in the provided content, use "Unknown" for ` +
              `string fields and [] for arrays. Do not guess or hallucinate data not present ` +
              `in the content.${disambiguationBlock}\n\nWeb content:\n${context}`,
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
}
