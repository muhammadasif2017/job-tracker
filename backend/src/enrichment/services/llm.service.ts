import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { Logger } from 'nestjs-pino';

export interface CompanyData {
  industry: string;
  companySize: string;
  techStack: string[];
  cultureSummary: string;
  remotePolicy: string;
  workLifeBalance: string;
  headquarters: string;
  founded: string;
}

const UNKNOWN_DATA: CompanyData = {
  industry: 'Unknown',
  companySize: 'Unknown',
  techStack: [],
  cultureSummary: 'Unknown',
  remotePolicy: 'Unknown',
  workLifeBalance: 'Unknown',
  headquarters: 'Unknown',
  founded: 'Unknown',
};

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'extract_company_data',
  description: 'Extract structured company information from web content',
  input_schema: {
    type: 'object' as const,
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
      'founded',
    ],
  },
};

function sanitize(raw: Record<string, unknown>): CompanyData {
  return {
    industry: typeof raw.industry === 'string' ? raw.industry : 'Unknown',
    companySize:
      typeof raw.companySize === 'string' ? raw.companySize : 'Unknown',
    techStack: Array.isArray(raw.techStack)
      ? raw.techStack.filter((t): t is string => typeof t === 'string')
      : [],
    cultureSummary:
      typeof raw.cultureSummary === 'string' ? raw.cultureSummary : 'Unknown',
    remotePolicy:
      typeof raw.remotePolicy === 'string' ? raw.remotePolicy : 'Unknown',
    workLifeBalance:
      typeof raw.workLifeBalance === 'string' ? raw.workLifeBalance : 'Unknown',
    headquarters:
      typeof raw.headquarters === 'string' ? raw.headquarters : 'Unknown',
    founded: typeof raw.founded === 'string' ? raw.founded : 'Unknown',
  };
}

@Injectable()
export class LlmService {
  private readonly client: Anthropic;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {
    this.client = new Anthropic({
      apiKey: this.config.get('ANTHROPIC_API_KEY'),
    });
  }

  async extract(companyName: string, context: string): Promise<CompanyData> {
    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        tools: [EXTRACT_TOOL],
        tool_choice: { type: 'any' },
        messages: [
          {
            role: 'user',
            content:
              `You are helping a job applicant evaluate a company. Extract structured data ` +
              `from the following web content about "${companyName}".\n\n` +
              `If information is not available in the provided content, use "Unknown" for ` +
              `string fields and [] for arrays. Do not guess or hallucinate data not present ` +
              `in the content.\n\nWeb content:\n${context}`,
          },
        ],
      });

      const toolUse = response.content.find((b) => b.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') return { ...UNKNOWN_DATA };

      return sanitize(toolUse.input as Record<string, unknown>);
    } catch (err) {
      this.logger.warn('llm_extract_failed', {
        company: companyName,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ...UNKNOWN_DATA };
    }
  }
}
