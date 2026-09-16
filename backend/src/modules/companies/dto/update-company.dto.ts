import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { CompanyCity, Priority } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CreateCompanyDto } from './create-company.dto.js';

// These four map to non-nullable columns. PartialType adds `@IsOptional()`,
// which skips validation for null as well as undefined, so a null reached
// Prisma and surfaced as a 500. They are redeclared as omittable-but-not-
// nullable: an omitted key leaves the column alone, an explicit null is a 400.
// Every other field keeps PartialType's behaviour, where null clears it
// (ADR-022).
const NON_NULLABLE_FIELDS = ['name', 'city', 'priority', 'techStack'] as const;
const whenPresent = () => ValidateIf((_, value) => value !== undefined);

export class UpdateCompanyDto extends PartialType(
  OmitType(CreateCompanyDto, NON_NULLABLE_FIELDS),
) {
  @ApiPropertyOptional({ example: 'Systems Limited', maxLength: 200 })
  @whenPresent()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: CompanyCity })
  @whenPresent()
  @IsEnum(CompanyCity)
  city?: CompanyCity;

  @ApiPropertyOptional({ enum: Priority })
  @whenPresent()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ example: ['React', 'Node.js', 'AWS'], type: [String] })
  @whenPresent()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  techStack?: string[];
}
