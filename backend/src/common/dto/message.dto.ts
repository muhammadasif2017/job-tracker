import { ApiProperty } from '@nestjs/swagger';

/** Response body for endpoints that return only a confirmation message. */
export class MessageDto {
  @ApiProperty({ example: 'Operation successful' })
  message: string;
}
