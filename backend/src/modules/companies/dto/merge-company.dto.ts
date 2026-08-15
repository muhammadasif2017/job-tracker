import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class MergeCompanyDto {
  @ApiProperty({
    format: 'cuid',
    description: 'The company to merge into the canonical company (:id in the URL) and delete',
  })
  @IsString()
  @IsNotEmpty()
  duplicateCompanyId: string;
}
