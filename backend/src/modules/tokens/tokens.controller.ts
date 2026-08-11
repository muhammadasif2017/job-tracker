import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { TokensService } from './tokens.service.js';
import { CreateTokenDto } from './dto/create-token.dto.js';
import { CreatedTokenDto } from './dto/created-token.dto.js';
import { TokenResponseDto } from './dto/token-response.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('tokens')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('tokens')
export class TokensController {
  constructor(private tokensService: TokensService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a personal access token (e.g. for the browser extension) — raw value is only ever returned here',
  })
  @ApiCreatedResponse({ type: CreatedTokenDto })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateTokenDto) {
    return this.tokensService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List active personal access tokens' })
  @ApiOkResponse({ type: TokenResponseDto, isArray: true })
  findAll(@CurrentUser() user: { id: string }) {
    return this.tokensService.findAll(user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a personal access token' })
  @ApiParam({ name: 'id', description: 'Token ID' })
  @ApiOkResponse({ type: MessageDto })
  @ApiNotFoundResponse({ description: 'Token not found' })
  revoke(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.tokensService.revoke(user.id, id);
  }
}
