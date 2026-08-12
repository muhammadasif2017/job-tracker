import { Test } from '@nestjs/testing';
import { TokensController } from './tokens.controller.js';
import { TokensService } from './tokens.service.js';

const mockService = {
  create: jest.fn(),
  findAll: jest.fn(),
  revoke: jest.fn(),
};

const user = { id: 'u-1' };

describe('TokensController', () => {
  let controller: TokensController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [TokensController],
      providers: [{ provide: TokensService, useValue: mockService }],
    }).compile();
    controller = module.get(TokensController);
  });

  describe('create', () => {
    it('delegates to service with userId and dto', async () => {
      const dto = { name: 'Chrome extension' };
      mockService.create.mockResolvedValue({ id: 't-1', token: 'jt_pat_...' });

      await controller.create(user, dto);

      expect(mockService.create).toHaveBeenCalledWith('u-1', dto);
    });
  });

  describe('findAll', () => {
    it('delegates to service with userId', async () => {
      mockService.findAll.mockResolvedValue([]);

      await controller.findAll(user);

      expect(mockService.findAll).toHaveBeenCalledWith('u-1');
    });
  });

  describe('revoke', () => {
    it('delegates to service with userId and token id', async () => {
      mockService.revoke.mockResolvedValue({ message: 'Token revoked' });

      const result = await controller.revoke(user, 't-1');

      expect(mockService.revoke).toHaveBeenCalledWith('u-1', 't-1');
      expect(result).toEqual({ message: 'Token revoked' });
    });
  });
});
