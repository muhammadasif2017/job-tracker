import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Per-company application counts and reply rate.
 *
 * docs/specs/company-reply-history.md — WISHLIST jobs are excluded, and
 * `replied` and `ghosted` can overlap (a job that replied then went silent).
 */
export class CompanyApplicationStatsDto {
  @ApiProperty({ example: 4, description: 'Jobs applied to (not WISHLIST)' })
  applied: number;

  @ApiProperty({
    example: 1,
    description: 'Jobs that ever reached INTERVIEWING, OFFER or REJECTED',
  })
  replied: number;

  @ApiProperty({
    example: 2,
    description:
      'Jobs marked GHOSTED plus open jobs silent for 14+ days (dismissals ignored)',
  })
  ghosted: number;

  @ApiProperty({ example: 25, description: 'replied / applied, in percent' })
  replyRate: number;

  @ApiPropertyOptional({ format: 'date-time' })
  lastAppliedAt: Date | null;
}
