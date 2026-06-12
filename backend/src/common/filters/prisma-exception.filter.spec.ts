import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { PrismaExceptionFilter } from './prisma-exception.filter.js';

const mockResponse = {
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
};
const mockHost = {
  switchToHttp: jest.fn().mockReturnValue({
    getResponse: jest.fn().mockReturnValue(mockResponse),
  }),
};

describe('PrismaExceptionFilter', () => {
  let filter: PrismaExceptionFilter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResponse.status.mockReturnThis();
    mockResponse.json.mockReturnThis();
    filter = new PrismaExceptionFilter();
  });

  it('passes NestJS HttpException through with its own status and body', () => {
    const exception = new HttpException(
      { message: 'Access denied', statusCode: 403 },
      HttpStatus.FORBIDDEN,
    );
    filter.catch(exception, mockHost as never);
    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Access denied', statusCode: 403 }),
    );
  });

  it('maps Prisma P2002 (unique constraint) to 409 Conflict', () => {
    filter.catch({ code: 'P2002' }, mockHost as never);
    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, error: 'Conflict' }),
    );
  });

  it('maps Prisma P2025 (record not found) to 404 Not Found', () => {
    filter.catch({ code: 'P2025' }, mockHost as never);
    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, error: 'Not Found' }),
    );
  });

  it('returns 500 for unknown errors without leaking internal details', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    filter.catch(new Error('pg: connection refused'), mockHost as never);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    const body = mockResponse.json.mock.calls[0][0] as { message: string };
    expect(body.message).toBe('Internal server error');
    expect(body).not.toHaveProperty('stack');
  });
});
