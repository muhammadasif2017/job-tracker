import { IsUUID } from 'class-validator';

export class ExchangeCodeDto {
  @IsUUID('4')
  code: string;
}
