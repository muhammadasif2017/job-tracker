import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { AdminQueuesController } from './admin-queues.controller.js';
import { AdminQueuesService } from './admin-queues.service.js';
import { QueueObservabilityDto } from './dto/admin-queues.dto.js';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';

const snapshot: QueueObservabilityDto = {
  queues: [
    {
      name: 'company-target-enrichment',
      available: true,
      counts: {
        waiting: 1,
        active: 0,
        delayed: 0,
        failed: 0,
        completed: 9,
      },
    },
  ],
  companyStatuses: [{ status: null, label: 'Never triggered', count: 4 }],
  strandedPending: 0,
};

const mockService = { getObservability: jest.fn() };

describe('AdminQueuesController', () => {
  let controller: AdminQueuesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockService.getObservability.mockResolvedValue(snapshot);
    const module = await Test.createTestingModule({
      controllers: [AdminQueuesController],
      providers: [{ provide: AdminQueuesService, useValue: mockService }],
    }).compile();
    controller = module.get(AdminQueuesController);
  });

  it('returns the service snapshot unchanged', async () => {
    await expect(controller.getObservability()).resolves.toEqual(snapshot);
    expect(mockService.getObservability).toHaveBeenCalledTimes(1);
  });

  it('is gated on the ADMIN role, like every other admin route', () => {
    const roles = new Reflector().get<Role[]>(ROLES_KEY, AdminQueuesController);

    expect(roles).toEqual([Role.ADMIN]);
  });
});
