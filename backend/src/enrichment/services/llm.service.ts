import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

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

@Injectable()
export class LlmService {
  private readonly client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

      return toolUse.input as CompanyData;
    } catch {
      return { ...UNKNOWN_DATA };
    }
  }
}
