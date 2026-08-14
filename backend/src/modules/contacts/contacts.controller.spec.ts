import { Test } from '@nestjs/testing';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';

const mockService = {
  create: jest.fn(),
  findAllFor: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

const user = { id: 'u-1' };

describe('ContactsController', () => {
  let controller: ContactsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [ContactsController],
      providers: [{ provide: ContactsService, useValue: mockService }],
    }).compile();
    controller = module.get(ContactsController);
  });

  describe('create', () => {
    it('delegates to service with userId, a jobId ref, and dto', async () => {
      const dto = { name: 'Jane Doe', role: 'Recruiter' };
      mockService.create.mockResolvedValue({ id: 'c-1' });

      await controller.create(user, 'j-1', dto);

      expect(mockService.create).toHaveBeenCalledWith(
        'u-1',
        { jobId: 'j-1' },
        dto,
      );
    });

    it('returns the result from the service', async () => {
      const contact = { id: 'c-1', name: 'Jane Doe' };
      mockService.create.mockResolvedValue(contact);

      const result = await controller.create(user, 'j-1', { name: 'Jane Doe' });

      expect(result).toEqual(contact);
    });
  });

  describe('findAll', () => {
    it('delegates to service with userId and a jobId ref', async () => {
      mockService.findAllFor.mockResolvedValue([]);

      await controller.findAll(user, 'j-1');

      expect(mockService.findAllFor).toHaveBeenCalledWith('u-1', {
        jobId: 'j-1',
      });
    });

    it('returns the contacts from the service', async () => {
      const contacts = [{ id: 'c-1' }, { id: 'c-2' }];
      mockService.findAllFor.mockResolvedValue(contacts);

      const result = await controller.findAll(user, 'j-1');

      expect(result).toEqual(contacts);
    });
  });

  describe('update', () => {
    it('delegates to service with userId, a jobId ref, contactId, and dto', async () => {
      const dto = { role: 'Hiring Manager' };
      mockService.update.mockResolvedValue({
        id: 'c-1',
        role: 'Hiring Manager',
      });

      await controller.update(user, 'j-1', 'c-1', dto);

      expect(mockService.update).toHaveBeenCalledWith(
        'u-1',
        { jobId: 'j-1' },
        'c-1',
        dto,
      );
    });
  });

  describe('remove', () => {
    it('delegates to service with userId, a jobId ref, and contactId', async () => {
      mockService.remove.mockResolvedValue({ message: 'Contact deleted' });

      await controller.remove(user, 'j-1', 'c-1');

      expect(mockService.remove).toHaveBeenCalledWith(
        'u-1',
        { jobId: 'j-1' },
        'c-1',
      );
    });

    it('returns the success message from the service', async () => {
      mockService.remove.mockResolvedValue({ message: 'Contact deleted' });

      const result = await controller.remove(user, 'j-1', 'c-1');

      expect(result).toEqual({ message: 'Contact deleted' });
    });
  });
});
