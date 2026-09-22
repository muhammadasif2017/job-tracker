import { BadRequestException } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import {
  assertCompanyNotCleared,
  companyLabelToResolve,
  shouldRestampAppliedAt,
} from './job-update-rules.helper.js';
import { UpdateJobDto } from './dto/update-job.dto.js';

const dto = (fields: Partial<UpdateJobDto>) => fields as UpdateJobDto;

const APPLIED_AT = new Date('2026-06-01T00:00:00Z');

describe('assertCompanyNotCleared', () => {
  it('rejects an explicit null, which PartialType lets past DTO validation', () => {
    expect(() =>
      assertCompanyNotCleared(dto({ company: null as unknown as string })),
    ).toThrow(BadRequestException);
  });

  it('accepts an omitted company — that means "leave it unchanged"', () => {
    expect(() =>
      assertCompanyNotCleared(dto({ position: 'Dev' })),
    ).not.toThrow();
  });
});

describe('companyLabelToResolve', () => {
  const linked = { company: 'Systems Limited', companyId: 'company-1' };

  it('returns null when the client omitted the company field', () => {
    expect(companyLabelToResolve(dto({ position: 'Dev' }), linked)).toBeNull();
  });

  it('returns null when JobForm resends the current label untouched', () => {
    expect(
      companyLabelToResolve(dto({ company: 'Systems Limited' }), linked),
    ).toBeNull();
  });

  it('ignores case and surrounding whitespace when comparing to the current label', () => {
    expect(
      companyLabelToResolve(dto({ company: '  systems limited  ' }), linked),
    ).toBeNull();
  });

  it('returns the trimmed label when the user actually edited it', () => {
    expect(
      companyLabelToResolve(dto({ company: '  Acme Corp  ' }), linked),
    ).toBe('Acme Corp');
  });

  it('resolves an identical label when no company is linked yet, so the FK gets filled', () => {
    expect(
      companyLabelToResolve(dto({ company: 'Systems Limited' }), {
        company: 'Systems Limited',
        companyId: null,
      }),
    ).toBe('Systems Limited');
  });
});

describe('shouldRestampAppliedAt', () => {
  const leavingWishlist = {
    statusChanged: true,
    existingStatus: JobStatus.WISHLIST,
    existingAppliedAt: APPLIED_AT,
  };

  it('re-stamps when a job leaves WISHLIST and the date was not touched', () => {
    expect(
      shouldRestampAppliedAt({
        ...leavingWishlist,
        submittedAppliedAt: undefined,
      }),
    ).toBe(true);
  });

  it('re-stamps when JobForm resends the stored date untouched', () => {
    // The re-stamp has to survive this: JobForm resends every field on every
    // submit, so "sent an appliedAt" cannot mean "edited the appliedAt".
    expect(
      shouldRestampAppliedAt({
        ...leavingWishlist,
        submittedAppliedAt: new Date(APPLIED_AT),
      }),
    ).toBe(true);
  });

  it('leaves a date the user genuinely changed alone', () => {
    expect(
      shouldRestampAppliedAt({
        ...leavingWishlist,
        submittedAppliedAt: new Date('2026-07-15T00:00:00Z'),
      }),
    ).toBe(false);
  });

  it('does not re-stamp a status change that did not start in WISHLIST', () => {
    expect(
      shouldRestampAppliedAt({
        statusChanged: true,
        existingStatus: JobStatus.APPLIED,
        existingAppliedAt: APPLIED_AT,
        submittedAppliedAt: undefined,
      }),
    ).toBe(false);
  });

  it('does not re-stamp an edit that left the status alone', () => {
    expect(
      shouldRestampAppliedAt({
        statusChanged: false,
        existingStatus: JobStatus.WISHLIST,
        existingAppliedAt: APPLIED_AT,
        submittedAppliedAt: undefined,
      }),
    ).toBe(false);
  });
});
