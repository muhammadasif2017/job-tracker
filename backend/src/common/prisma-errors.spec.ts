import { isTransactionWriteConflict } from './prisma-errors.js';

describe('isTransactionWriteConflict', () => {
  it('recognizes a PrismaClientKnownRequestError-shaped P2034', () => {
    expect(isTransactionWriteConflict({ code: 'P2034' })).toBe(true);
  });

  it('recognizes a raw DriverAdapterError commit-time conflict', () => {
    expect(
      isTransactionWriteConflict({
        name: 'DriverAdapterError',
        cause: { kind: 'TransactionWriteConflict' },
      }),
    ).toBe(true);
  });

  it('rejects a DriverAdapterError with a different cause kind', () => {
    expect(
      isTransactionWriteConflict({
        name: 'DriverAdapterError',
        cause: { kind: 'UniqueConstraintViolation' },
      }),
    ).toBe(false);
  });

  it('rejects an unrelated Prisma error code', () => {
    expect(isTransactionWriteConflict({ code: 'P2002' })).toBe(false);
  });

  it('rejects non-object and nullish values', () => {
    expect(isTransactionWriteConflict(null)).toBe(false);
    expect(isTransactionWriteConflict(undefined)).toBe(false);
    expect(isTransactionWriteConflict('P2034')).toBe(false);
    expect(isTransactionWriteConflict(new Error('boom'))).toBe(false);
  });
});
