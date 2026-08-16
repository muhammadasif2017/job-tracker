import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// Phase 5b (docs/specs/company-fk-phase5b.md) — only the AI-enrichment field
// set is pickable; user-curated identity fields (websiteUrl, personalNotes,
// businessMode, etc.) stay canonical-wins unconditionally, no override path
// for them. An absent key means "keep canonical's current value" — this is
// a sparse patch, not a full replacement, so the frontend only sends the
// fields the user actually picked the duplicate's value for.
export class MergeFieldOverridesDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  industry?: string | null;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  companySize?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  techStack?: string[];

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cultureSummary?: string | null;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  workPolicy?: string | null;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  workLifeBalance?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  headquarters?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  headquartersLowConfidence?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  addressLowConfidence?: boolean;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  founded?: string | null;
}

export class MergeCompanyDto {
  @ApiProperty({
    format: 'cuid',
    description: 'The company to merge into the canonical company (:id in the URL) and delete',
  })
  @IsString()
  @IsNotEmpty()
  duplicateCompanyId: string;

  @ApiPropertyOptional({
    type: () => MergeFieldOverridesDto,
    description:
      'Per-field picks when canonical and duplicate have differing enrichment data — only include fields the user explicitly chose the duplicate\'s value for',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MergeFieldOverridesDto)
  fieldOverrides?: MergeFieldOverridesDto;
}
