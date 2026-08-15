import { ApiProperty } from '@nestjs/swagger';
import { CompanyResponseDto } from './company-response.dto.js';

export class DuplicateSuggestionDto {
  @ApiProperty({ type: () => CompanyResponseDto })
  companyA: CompanyResponseDto;

  @ApiProperty({ type: () => CompanyResponseDto })
  companyB: CompanyResponseDto;

  @ApiProperty({ enum: ['website', 'name'] })
  reason: 'website' | 'name';
}
