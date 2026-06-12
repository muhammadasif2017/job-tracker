import { Test } from '@nestjs/testing';
import { LlmService } from './llm.service.js';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

const toolUseResponse = {
  content: [
    {
      type: 'tool_use',
      id: 'toolu_01',
      name: 'extract_company_data',
      input: {
        industry: 'FinTech',
        companySize: 'Mid-size (200-1000)',
        techStack: ['React', 'Node.js', 'PostgreSQL'],
        cultureSummary: 'Fast-paced culture with strong engineering standards.',
        remotePolicy: 'Hybrid',
        workLifeBalance: 'Good',
        headquarters: 'San Francisco, USA',
        founded: '2010',
      },
    },
  ],
};

describe('LlmService', () => {
  let service: LlmService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [LlmService],
    }).compile();
    service = module.get(LlmService);
  });

  it('returns CompanyData extracted from the tool_use response', async () => {
    mockCreate.mockResolvedValue(toolUseResponse);

    const result = await service.extract(
      'Stripe',
      'Stripe processes payments...',
    );

    expect(result.industry).toBe('FinTech');
    expect(result.companySize).toBe('Mid-size (200-1000)');
    expect(result.techStack).toEqual(['React', 'Node.js', 'PostgreSQL']);
    expect(result.remotePolicy).toBe('Hybrid');
    expect(result.workLifeBalance).toBe('Good');
    expect(result.headquarters).toBe('San Francisco, USA');
    expect(result.founded).toBe('2010');
  });

  it('includes the company name and context in the prompt sent to Claude', async () => {
    mockCreate.mockResolvedValue(toolUseResponse);

    await service.extract('Acme Corp', 'Acme builds widgets.');

    const call = mockCreate.mock.calls[0][0] as {
      messages: { role: string; content: string }[];
    };
    const prompt = call.messages[0].content;
    expect(prompt).toContain('Acme Corp');
    expect(prompt).toContain('Acme builds widgets.');
  });

  it('returns all-Unknown defaults when response contains no tool_use block', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: "I can't help with that." }],
    });

    const result = await service.extract('Acme', 'some context');

    expect(result.industry).toBe('Unknown');
    expect(result.companySize).toBe('Unknown');
    expect(result.techStack).toEqual([]);
    expect(result.cultureSummary).toBe('Unknown');
    expect(result.remotePolicy).toBe('Unknown');
    expect(result.workLifeBalance).toBe('Unknown');
    expect(result.headquarters).toBe('Unknown');
    expect(result.founded).toBe('Unknown');
  });

  it('returns all-Unknown defaults when the Anthropic SDK throws', async () => {
    mockCreate.mockRejectedValue(new Error('API unavailable'));

    const result = await service.extract('Acme', 'context');

    expect(result.industry).toBe('Unknown');
    expect(result.techStack).toEqual([]);
  });

  it('uses tool_choice any to force tool use', async () => {
    mockCreate.mockResolvedValue(toolUseResponse);

    await service.extract('Acme', 'context');

    const call = mockCreate.mock.calls[0][0] as {
      tool_choice: { type: string };
    };
    expect(call.tool_choice).toEqual({ type: 'any' });
  });
});
