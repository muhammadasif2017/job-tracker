import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';
import { MAX_GHOST_SUGGESTIONS } from '../ghost-suggestions.helper.js';

export class MarkGhostedDto {
  @ApiProperty({
    type: [String],
    example: ['cmu18sgs801l2a0w8irq9wjr4'],
    description:
      'Job ids the user saw on the "Looks ghosted" card. Ids that are no longer suggestions are skipped.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_GHOST_SUGGESTIONS)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  jobIds: string[];
}

export class MarkGhostedResultDto {
  @ApiProperty({ example: 12, description: 'Jobs moved to GHOSTED' })
  updated: number;
}
