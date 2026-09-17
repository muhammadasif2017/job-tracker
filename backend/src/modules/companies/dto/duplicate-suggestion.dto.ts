import { ApiProperty } from '@nestjs/swagger';
import { CompanyResponseDto } from './company-response.dto.js';

/**
 * A pair of companies that look like duplicates, and whether the website or
 * the name matched.
 */
export class DuplicateSuggestionDto {
  @ApiProperty({ type: () => CompanyResponseDto })
  companyA: CompanyResponseDto;

  @ApiProperty({ type: () => CompanyResponseDto })
  companyB: CompanyResponseDto;

  @ApiProperty({ enum: ['website', 'name'] })
  reason: 'website' | 'name';
}
