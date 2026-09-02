import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import {
  JobStatus,
  JobPriority,
  JobType,
  DiscoverySource,
  ApplicationChannel,
} from '@prisma/client';

// Trims before validation so `@IsNotEmpty()` rejects a whitespace-only value
// instead of letting it through. Without this, "   " passes validation and
// then `resolveCompanyId` trims it to "" — silently storing a blank company
// label with a null companyId. It also keeps `Job.company` byte-identical to
// the name the Company FK was resolved from, so a later edit's
// "label unchanged" check can't miss on surrounding whitespace.
const TrimString = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

export class CreateJobDto {
  @ApiProperty({ example: 'Acme Corp', maxLength: 200 })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  company: string;

  @ApiProperty({ example: 'Senior Engineer', maxLength: 200 })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  position: string;

  // `| null` (not just optional) on every nullable column below: the
  // frontend sends an explicit `null` — not an omitted key — to clear a
  // previously-set value on edit. `JSON.stringify` drops `undefined` keys
  // and Prisma treats an omitted field as "leave the column alone", so only
  // an explicit `null` clears it (ADR-022, same shape as CreateContactDto).
  // `company`, `position` and `appliedAt` are deliberately excluded — those
  // columns are non-nullable, and `update()` rejects `company: null`
  // outright.
  @ApiPropertyOptional({ example: 'Remote', maxLength: 200 })
  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(200)
  location?: string | null;

  @ApiPropertyOptional({
    example: 'https://jobs.example.com/123',
    maxLength: 500,
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  url?: string | null;

  @ApiPropertyOptional({ enum: JobStatus })
  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  @ApiPropertyOptional({ enum: JobPriority })
  @IsOptional()
  @IsEnum(JobPriority)
  priority?: JobPriority;

  @ApiPropertyOptional({ enum: JobType })
  @IsOptional()
  @IsEnum(JobType)
  jobType?: JobType;

  @ApiPropertyOptional({ enum: DiscoverySource })
  @IsOptional()
  @IsEnum(DiscoverySource)
  discoverySource?: DiscoverySource | null;

  @ApiPropertyOptional({ enum: ApplicationChannel })
  @IsOptional()
  @IsEnum(ApplicationChannel)
  applicationChannel?: ApplicationChannel | null;

  @ApiPropertyOptional({ example: 'Referral from John', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @ApiPropertyOptional({ example: '2024-03-15', format: 'date' })
  @IsOptional()
  @IsDateString()
  appliedAt?: string;
}
