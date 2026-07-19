import { Test } from '@nestjs/testing';
import { InterviewRoundsController } from './interview-rounds.controller.js';
import { InterviewRoundsService } from './interview-rounds.service.js';

const mockService = {
  create: jest.fn(),
  findAllForJob: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

const user = { id: 'u-1' };

describe('InterviewRoundsController', () => {
  let controller: InterviewRoundsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [InterviewRoundsController],
      providers: [{ provide: InterviewRoundsService, useValue: mockService }],
    }).compile();
    controller = module.get(InterviewRoundsController);
  });

  describe('create', () => {
    it('delegates to service with userId, jobId, and dto', async () => {
      const dto = { stage: 'Phone Screen', scheduledAt: '2026-08-01' };
      mockService.create.mockResolvedValue({ id: 'r-1' });

      await controller.create(user, 'j-1', dto);

      expect(mockService.create).toHaveBeenCalledWith('u-1', 'j-1', dto);
    });

    it('returns the result from the service', async () => {
      const round = { id: 'r-1', stage: 'Phone Screen' };
      mockService.create.mockResolvedValue(round);

      const result = await controller.create(user, 'j-1', {
        stage: 'Phone Screen',
        scheduledAt: '2026-08-01',
      });

      expect(result).toEqual(round);
    });
  });

  describe('findAll', () => {
    it('delegates to service with userId and jobId', async () => {
      mockService.findAllForJob.mockResolvedValue([]);

      await controller.findAll(user, 'j-1');

      expect(mockService.findAllForJob).toHaveBeenCalledWith('u-1', 'j-1');
    });

    it('returns the rounds from the service', async () => {
      const rounds = [{ id: 'r-1' }, { id: 'r-2' }];
      mockService.findAllForJob.mockResolvedValue(rounds);

      const result = await controller.findAll(user, 'j-1');

      expect(result).toEqual(rounds);
    });
  });

  describe('update', () => {
    it('delegates to service with userId, jobId, roundId, and dto', async () => {
      const dto = { outcome: 'PASSED' as const };
      mockService.update.mockResolvedValue({ id: 'r-1', outcome: 'PASSED' });

      await controller.update(user, 'j-1', 'r-1', dto);

      expect(mockService.update).toHaveBeenCalledWith(
        'u-1',
        'j-1',
        'r-1',
        dto,
      );
    });
  });

  describe('remove', () => {
    it('delegates to service with userId, jobId, and roundId', async () => {
      mockService.remove.mockResolvedValue({
        message: 'Interview round deleted',
      });

      await controller.remove(user, 'j-1', 'r-1');

      expect(mockService.remove).toHaveBeenCalledWith('u-1', 'j-1', 'r-1');
    });

    it('returns the success message from the service', async () => {
      mockService.remove.mockResolvedValue({
        message: 'Interview round deleted',
      });

      const result = await controller.remove(user, 'j-1', 'r-1');

      expect(result).toEqual({ message: 'Interview round deleted' });
    });
  });
});
