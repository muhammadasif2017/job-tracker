import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { LlmService } from './llm.service.js';

const mockLogger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
const mockCreate = jest.fn();

jest.mock('groq-sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

const mockConfigService = { get: jest.fn().mockReturnValue('test-api-key') };

const baseInput = {
  industry: 'FinTech',
  companySize: 'Mid-size (200-1000)',
  techStack: ['React', 'Node.js', 'PostgreSQL'],
  cultureSummary: 'Fast-paced culture with strong engineering standards.',
  workPolicy: 'Hybrid',
  workLifeBalance: 'Good',
  headquarters: 'San Francisco, USA',
  founded: '2010',
};

function groqResponse(input: Record<string, unknown>) {
  return {
    choices: [
      {
        message: {
          tool_calls: [{ function: { arguments: JSON.stringify(input) } }],
        },
      },
    ],
  };
}

const toolCallResponse = groqResponse(baseInput);

describe('LlmService', () => {
  let service: LlmService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue('test-api-key');
    const module = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();
    service = module.get(LlmService);
  });

  it('returns CompanyData extracted from the tool_call response', async () => {
    mockCreate.mockResolvedValue(toolCallResponse);

    const result = await service.extract(
      'Stripe',
      'Stripe processes payments...',
    );

    expect(result.industry).toBe('FinTech');
    expect(result.companySize).toBe('Mid-size (200-1000)');
    expect(result.techStack).toEqual(['React', 'Node.js', 'PostgreSQL']);
    expect(result.workPolicy).toBe('Hybrid');
    expect(result.workLifeBalance).toBe('Good');
    expect(result.headquarters).toBe('San Francisco, USA');
    expect(result.founded).toBe('2010');
  });

  it('includes the company name and context in the prompt sent to Groq', async () => {
    mockCreate.mockResolvedValue(toolCallResponse);

    await service.extract('Acme Corp', 'Acme builds widgets.');

    const call = mockCreate.mock.calls[0][0] as {
      messages: { role: string; content: string }[];
    };
    const prompt = call.messages[0].content;
    expect(prompt).toContain('Acme Corp');
    expect(prompt).toContain('Acme builds widgets.');
  });

  it('throws when response contains no tool call', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: {} }] });

    await expect(service.extract('Acme', 'some context')).rejects.toThrow(
      'No tool call in Groq response',
    );
  });

  it('re-throws when Groq SDK throws', async () => {
    mockCreate.mockRejectedValue(new Error('API unavailable'));

    await expect(service.extract('Acme', 'context')).rejects.toThrow(
      'API unavailable',
    );
  });

  it('uses tool_choice required to force tool use', async () => {
    mockCreate.mockResolvedValue(toolCallResponse);

    await service.extract('Acme', 'context');

    const call = mockCreate.mock.calls[0][0] as { tool_choice: string };
    expect(call.tool_choice).toBe('required');
  });

  it('falls back to [] for a null techStack instead of throwing', async () => {
    mockCreate.mockResolvedValue(
      groqResponse({ ...baseInput, techStack: null }),
    );

    const result = await service.extract('Acme', 'context');

    expect(result.techStack).toEqual([]);
    expect(result.industry).toBe('FinTech');
  });

  it('filters non-string items from a mixed techStack array', async () => {
    mockCreate.mockResolvedValue(
      groqResponse({
        ...baseInput,
        techStack: ['TypeScript', 42, null, 'React'],
      }),
    );

    const result = await service.extract('Acme', 'context');

    expect(result.techStack).toEqual(['TypeScript', 'React']);
  });

  it('converts empty string and whitespace-only fields to Unknown', async () => {
    mockCreate.mockResolvedValue(
      groqResponse({ ...baseInput, industry: '', headquarters: '   ' }),
    );

    const result = await service.extract('Acme', 'context');

    expect(result.industry).toBe('Unknown');
    expect(result.headquarters).toBe('Unknown');
  });
});
