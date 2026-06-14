import { ApiProperty } from '@nestjs/swagger';

export class ResumeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  jobId: string;

  @ApiProperty({ example: 'resume-2024.pdf' })
  originalName: string;

  @ApiProperty({ example: 204800, description: 'File size in bytes' })
  size: number;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}
