import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import Groq from 'groq-sdk';
import { LlmService } from './llm.service.js';

const mockLogger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
const mockCreate = jest.fn();

jest.mock('groq-sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

const mockGroqConstructor = Groq as unknown as jest.Mock;

const mockConfigService = { get: jest.fn().mockReturnValue('test-api-key') };

const baseInput = {
  industry: 'FinTech',
  companySize: 'Mid-size (200-1000)',
  techStack: ['React', 'Node.js', 'PostgreSQL'],
  workPolicy: 'Hybrid',
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

  it('constructs the Groq client with a 45s request timeout and a pinned maxRetries of 1', () => {
    expect(mockGroqConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 45_000, maxRetries: 1 }),
    );
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

  // Regression: the disambiguation instruction used to read "if the content
  // describes a different company that merely shares the name, return
  // Unknown for all string fields". It was meant as "if ALL the content is
  // about a different company" but the model applied it whenever ANY snippet
  // was — and a small company's search results almost always mix a couple of
  // genuine hits in with several same-named businesses. The result was a run
  // that pulled 6 usable snippets and still wrote null to every column.
  it('scopes the same-name guard to individual snippets, not the whole extraction', async () => {
    mockCreate.mockResolvedValue(toolCallResponse);

    await service.extract('Acme Corp', 'Acme builds widgets.');

    const call = mockCreate.mock.calls[0][0] as {
      messages: { role: string; content: string }[];
    };
    const prompt = call.messages[0].content;

    // Discarding everything must be conditioned on NONE of the content
    // matching — never on the mere presence of a same-named company.
    expect(prompt).toMatch(/only when NONE of the content is about/i);
    expect(prompt).toMatch(/skipping that snippet — not discarding the whole/i);
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

  it('retries once on a tool_use_failed generation glitch and succeeds', async () => {
    const toolUseFailedError = Object.assign(new Error('400 tool_use_failed'), {
      status: 400,
      error: { error: { code: 'tool_use_failed' } },
    });
    mockCreate
      .mockRejectedValueOnce(toolUseFailedError)
      .mockResolvedValueOnce(toolCallResponse);

    const result = await service.extract('Acme', 'context');

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.industry).toBe('FinTech');
  });

  it('re-throws after a second tool_use_failed (no infinite retry)', async () => {
    const toolUseFailedError = Object.assign(new Error('400 tool_use_failed'), {
      status: 400,
      error: { error: { code: 'tool_use_failed' } },
    });
    mockCreate.mockRejectedValue(toolUseFailedError);

    await expect(service.extract('Acme', 'context')).rejects.toThrow(
      'tool_use_failed',
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-tool_use_failed 400 error', async () => {
    const otherError = Object.assign(new Error('400 invalid_request'), {
      status: 400,
      error: { error: { code: 'invalid_request_error' } },
    });
    mockCreate.mockRejectedValue(otherError);

    await expect(service.extract('Acme', 'context')).rejects.toThrow(
      'invalid_request',
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
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

  it('converts empty string and whitespace-only fields to null', async () => {
    mockCreate.mockResolvedValue(
      groqResponse({ ...baseInput, industry: '', workPolicy: '   ' }),
    );

    const result = await service.extract('Acme', 'context');

    expect(result.industry).toBeNull();
    expect(result.workPolicy).toBeNull();
  });
});

describe('LlmService.extractJobPosting', () => {
  let service: LlmService;

  const baseJobInput = {
    company: 'Acme Corp',
    position: 'Senior Engineer',
    location: 'Remote',
    jobType: 'REMOTE',
  };

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

  it('returns ParsedJobData extracted from the tool_call response', async () => {
    mockCreate.mockResolvedValue(groqResponse(baseJobInput));

    const result = await service.extractJobPosting('Acme Corp is hiring...');

    expect(result).toEqual({
      company: 'Acme Corp',
      position: 'Senior Engineer',
      location: 'Remote',
      jobType: 'REMOTE',
    });
  });

  it('throws when response contains no tool call', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: {} }] });

    await expect(service.extractJobPosting('some content')).rejects.toThrow(
      'No tool call in Groq response',
    );
  });

  it('re-throws when Groq SDK throws', async () => {
    mockCreate.mockRejectedValue(new Error('API unavailable'));

    await expect(service.extractJobPosting('content')).rejects.toThrow(
      'API unavailable',
    );
  });

  it('converts "Unknown" string fields to null', async () => {
    mockCreate.mockResolvedValue(
      groqResponse({ ...baseJobInput, company: 'Unknown', location: '' }),
    );

    const result = await service.extractJobPosting('content');

    expect(result.company).toBeNull();
    expect(result.location).toBeNull();
    expect(result.position).toBe('Senior Engineer');
  });

  it('drops jobType when it is not a valid enum value', async () => {
    mockCreate.mockResolvedValue(
      groqResponse({ ...baseJobInput, jobType: 'Unknown' }),
    );

    const result = await service.extractJobPosting('content');

    expect(result.jobType).toBeUndefined();
  });

  it('drops jobType when malformed (not a known enum string)', async () => {
    mockCreate.mockResolvedValue(
      groqResponse({ ...baseJobInput, jobType: 'FULL_TIME' }),
    );

    const result = await service.extractJobPosting('content');

    expect(result.jobType).toBeUndefined();
  });
});

function plainResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

describe('LlmService.generateRoundPrep', () => {
  let service: LlmService;

  const baseInput = {
    company: 'Acme Corp',
    position: 'Senior Engineer',
    completedStage: 'Phone Screen',
    completedNotes: 'They asked a lot about React and state management.',
    nextStage: 'Onsite',
  };

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

  it('returns the trimmed plain-text response', async () => {
    mockCreate.mockResolvedValue(
      plainResponse('  - Review React hooks\n- Ask about on-call  '),
    );

    const result = await service.generateRoundPrep(baseInput);

    expect(result).toBe('- Review React hooks\n- Ask about on-call');
  });

  it('includes the completed round notes and next stage in the prompt', async () => {
    mockCreate.mockResolvedValue(plainResponse('Some prep'));

    await service.generateRoundPrep(baseInput);

    const call = mockCreate.mock.calls[0][0] as {
      messages: { role: string; content: string }[];
    };
    const prompt = call.messages[0].content;
    expect(prompt).toContain(baseInput.completedNotes);
    expect(prompt).toContain(baseInput.nextStage);
  });

  it('does not use a tool call (plain completion)', async () => {
    mockCreate.mockResolvedValue(plainResponse('Some prep'));

    await service.generateRoundPrep(baseInput);

    const call = mockCreate.mock.calls[0][0] as { tools?: unknown };
    expect(call.tools).toBeUndefined();
  });

  it('throws on an empty response', async () => {
    mockCreate.mockResolvedValue(plainResponse('   '));

    await expect(service.generateRoundPrep(baseInput)).rejects.toThrow(
      'Empty response from Groq',
    );
  });

  it('re-throws when Groq SDK throws', async () => {
    mockCreate.mockRejectedValue(new Error('API unavailable'));

    await expect(service.generateRoundPrep(baseInput)).rejects.toThrow(
      'API unavailable',
    );
  });
});

describe('LlmService.summarizeEvents', () => {
  let service: LlmService;

  const context = { company: 'Acme Corp', position: 'Senior Engineer' };
  const events = [
    {
      type: 'CREATED',
      fromStatus: null,
      toStatus: 'APPLIED',
      note: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      type: 'STATUS_CHANGE',
      fromStatus: 'APPLIED',
      toStatus: 'INTERVIEWING',
      note: null,
      createdAt: new Date('2026-01-05T00:00:00.000Z'),
    },
  ];

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

  it('returns the trimmed plain-text response', async () => {
    mockCreate.mockResolvedValue(
      plainResponse('  Applied, then moved to interviewing.  '),
    );

    const result = await service.summarizeEvents(events, context);

    expect(result).toBe('Applied, then moved to interviewing.');
  });

  it('includes the company, position, and event timeline in the prompt', async () => {
    mockCreate.mockResolvedValue(plainResponse('Summary'));

    await service.summarizeEvents(events, context);

    const call = mockCreate.mock.calls[0][0] as {
      messages: { role: string; content: string }[];
    };
    const prompt = call.messages[0].content;
    expect(prompt).toContain('Acme Corp');
    expect(prompt).toContain('Senior Engineer');
    expect(prompt).toContain('STATUS_CHANGE');
  });

  it('throws on an empty response', async () => {
    mockCreate.mockResolvedValue(plainResponse(''));

    await expect(service.summarizeEvents(events, context)).rejects.toThrow(
      'Empty response from Groq',
    );
  });

  it('re-throws when Groq SDK throws', async () => {
    mockCreate.mockRejectedValue(new Error('API unavailable'));

    await expect(service.summarizeEvents(events, context)).rejects.toThrow(
      'API unavailable',
    );
  });
});
