import { findUserTimeZone } from './user-timezone.js';

describe('findUserTimeZone', () => {
  const prismaWith = (row: { timezone: string | null } | null) => ({
    user: { findUnique: jest.fn().mockResolvedValue(row) },
  });

  it("returns the user's stored zone and reads only that column", async () => {
    const prisma = prismaWith({ timezone: 'Asia/Karachi' });

    await expect(findUserTimeZone(prisma, 'user-1')).resolves.toEqual({
      timeZone: 'Asia/Karachi',
      invalidStoredZone: null,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { timezone: true },
    });
  });

  it('falls back to UTC without flagging a missing row or empty zone', async () => {
    await expect(findUserTimeZone(prismaWith(null), 'u')).resolves.toEqual({
      timeZone: 'UTC',
      invalidStoredZone: null,
    });
    await expect(
      findUserTimeZone(prismaWith({ timezone: null }), 'u'),
    ).resolves.toEqual({ timeZone: 'UTC', invalidStoredZone: null });
  });

  // A hand-edited row: callers get a usable zone and can log the bad value.
  it('falls back to UTC and reports a stored zone Intl cannot use', async () => {
    await expect(
      findUserTimeZone(prismaWith({ timezone: 'Not/AZone' }), 'u'),
    ).resolves.toEqual({ timeZone: 'UTC', invalidStoredZone: 'Not/AZone' });
  });
});
