import { IsString } from 'class-validator';

export class ExchangeCodeDto {
  @IsString()
  code: string;
}
