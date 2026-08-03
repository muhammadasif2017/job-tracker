import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContactsService } from './contacts.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const mockPrisma = {
  job: {
    findFirst: jest.fn(),
  },
  contact: {
    create: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
};

describe('ContactsService', () => {
  let service: ContactsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.contact.count.mockResolvedValue(0);
    const module = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ContactsService);
  });

  describe('ownership', () => {
    it('throws NotFoundException when the job does not belong to the user', async () => {
      mockPrisma.job.findFirst.mockResolvedValue(null);

      await expect(
        service.create('user-1', 'job-1', { name: 'Jane Doe' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.contact.create).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates the contact scoped to the job', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.contact.create.mockResolvedValue({ id: 'contact-1' });

      await service.create('user-1', 'job-1', {
        name: 'Jane Doe',
        role: 'Recruiter',
        email: 'jane@example.com',
      });

      expect(mockPrisma.contact.create).toHaveBeenCalledWith({
        data: {
          jobId: 'job-1',
          name: 'Jane Doe',
          role: 'Recruiter',
          email: 'jane@example.com',
          phone: undefined,
          linkedinUrl: undefined,
          notes: undefined,
        },
      });
    });

    it('rejects with BadRequestException once the job hits the contact cap', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.contact.count.mockResolvedValue(20);

      await expect(
        service.create('user-1', 'job-1', { name: 'One too many' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.contact.create).not.toHaveBeenCalled();
    });
  });

  describe('findAllForJob', () => {
    it('returns contacts ordered by createdAt', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.contact.findMany.mockResolvedValue([{ id: 'c1' }]);

      const result = await service.findAllForJob('user-1', 'job-1');

      expect(mockPrisma.contact.findMany).toHaveBeenCalledWith({
        where: { jobId: 'job-1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([{ id: 'c1' }]);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the contact does not belong to the job', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.contact.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', 'job-1', 'contact-x', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.contact.update).not.toHaveBeenCalled();
    });

    it('updates the contact when it belongs to the job', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.contact.findFirst.mockResolvedValue({ id: 'contact-1' });
      mockPrisma.contact.update.mockResolvedValue({
        id: 'contact-1',
        role: 'Hiring Manager',
      });

      const result = await service.update('user-1', 'job-1', 'contact-1', {
        role: 'Hiring Manager',
      });

      expect(mockPrisma.contact.update).toHaveBeenCalledWith({
        where: { id: 'contact-1' },
        data: {
          name: undefined,
          role: 'Hiring Manager',
          email: undefined,
          phone: undefined,
          linkedinUrl: undefined,
          notes: undefined,
        },
      });
      expect(result).toEqual({ id: 'contact-1', role: 'Hiring Manager' });
    });

    it('passes an explicit null through to clear a previously-set field', async () => {
      // Prisma treats an omitted/undefined field as "leave it alone" and
      // only an explicit null as "clear it" — the frontend relies on this
      // to let a user blank out an optional field they'd set earlier.
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.contact.findFirst.mockResolvedValue({ id: 'contact-1' });
      mockPrisma.contact.update.mockResolvedValue({
        id: 'contact-1',
        email: null,
      });

      await service.update('user-1', 'job-1', 'contact-1', { email: null });

      expect(mockPrisma.contact.update).toHaveBeenCalledWith({
        where: { id: 'contact-1' },
        data: {
          name: undefined,
          role: undefined,
          email: null,
          phone: undefined,
          linkedinUrl: undefined,
          notes: undefined,
        },
      });
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.contact.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.remove('user-1', 'job-1', 'contact-x'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes the contact scoped to the job', async () => {
      mockPrisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      mockPrisma.contact.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.remove('user-1', 'job-1', 'contact-1');

      expect(mockPrisma.contact.deleteMany).toHaveBeenCalledWith({
        where: { id: 'contact-1', jobId: 'job-1' },
      });
      expect(result).toEqual({ message: 'Contact deleted' });
    });
  });
});
