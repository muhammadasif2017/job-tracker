import { ApiProperty } from '@nestjs/swagger';
import { JobResponseDto } from './job-response.dto.js';

/**
 * Reasons a job needs attention. Order matters: `getAttentionItems`
 * destructures this array positionally, and the same order is the precedence
 * when a job matches several rules.
 */
export const ATTENTION_TYPES = [
  'UPCOMING_INTERVIEW',
  'STALE_INTERVIEWING',
  'STALE_APPLIED',
] as const;
/** One of `ATTENTION_TYPES`. */
export type AttentionType = (typeof ATTENTION_TYPES)[number];

export class AttentionItemDto {
  @ApiProperty({ enum: ATTENTION_TYPES, example: 'STALE_APPLIED' })
  type: AttentionType;

  @ApiProperty({
    description:
      'Timestamp the reason is based on: interview time, last activity, or applied date',
  })
  since: Date;

  @ApiProperty({ type: () => JobResponseDto })
  job: JobResponseDto;
}
