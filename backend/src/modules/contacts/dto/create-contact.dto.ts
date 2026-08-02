import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class CreateContactDto {
  @ApiProperty({ example: 'Jane Doe', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  // `| null` (not just optional) on these fields: the frontend sends an
  // explicit `null` — not an omitted key — to clear a previously-set value
  // on edit. Prisma treats an omitted/`undefined` field as "leave it alone"
  // and only an explicit `null` as "clear it", so the DTO must accept null
  // to make clearing a field possible at all.
  @ApiPropertyOptional({ example: 'Recruiter', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  role?: string | null;

  @ApiPropertyOptional({ example: 'jane.doe@example.com', maxLength: 255 })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  @ApiPropertyOptional({ example: '+1 555 123 4567', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional({
    example: 'https://www.linkedin.com/in/janedoe',
    maxLength: 500,
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  linkedinUrl?: string | null;

  @ApiPropertyOptional({
    example: 'Met at the referral call, mentioned team is hiring fast',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}
