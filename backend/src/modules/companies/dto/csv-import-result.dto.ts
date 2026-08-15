import { ApiProperty } from '@nestjs/swagger';

export class CsvImportErrorDto {
  @ApiProperty({ example: 3, description: '1-indexed row, header is row 1' })
  row: number;

  @ApiProperty({
    example:
      'Invalid city "Multan" — expected one of LAHORE, ISLAMABAD, KARACHI, OTHER',
  })
  message: string;
}

export class CsvImportResultDto {
  @ApiProperty({ example: 12 })
  imported: number;

  @ApiProperty({ type: () => CsvImportErrorDto, isArray: true })
  errors: CsvImportErrorDto[];
}
