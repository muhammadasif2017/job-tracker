import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';

// Soft cap, not a real-world limit — a legitimate job search doesn't produce
// dozens of contacts for one job. Guards against unbounded Contact growth
// from a scripted client, not a security boundary (contacts are already
// scoped to the owning user).
const MAX_CONTACTS_PER_JOB = 20;

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  private async ensureJobOwned(userId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId },
      select: { id: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  async create(userId: string, jobId: string, dto: CreateContactDto) {
    await this.ensureJobOwned(userId, jobId);
    const existingCount = await this.prisma.contact.count({ where: { jobId } });
    if (existingCount >= MAX_CONTACTS_PER_JOB) {
      throw new BadRequestException(
        `A job can have at most ${MAX_CONTACTS_PER_JOB} contacts`,
      );
    }
    return this.prisma.contact.create({
      data: {
        jobId,
        name: dto.name,
        role: dto.role,
        email: dto.email,
        phone: dto.phone,
        linkedinUrl: dto.linkedinUrl,
        notes: dto.notes,
      },
    });
  }

  async findAllForJob(userId: string, jobId: string) {
    await this.ensureJobOwned(userId, jobId);
    return this.prisma.contact.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(
    userId: string,
    jobId: string,
    contactId: string,
    dto: UpdateContactDto,
  ) {
    await this.ensureJobOwned(userId, jobId);
    const existing = await this.prisma.contact.findFirst({
      where: { id: contactId, jobId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Contact not found');
    return this.prisma.contact.update({
      where: { id: contactId },
      data: {
        name: dto.name,
        role: dto.role,
        email: dto.email,
        phone: dto.phone,
        linkedinUrl: dto.linkedinUrl,
        notes: dto.notes,
      },
    });
  }

  async remove(userId: string, jobId: string, contactId: string) {
    await this.ensureJobOwned(userId, jobId);
    const { count } = await this.prisma.contact.deleteMany({
      where: { id: contactId, jobId },
    });
    if (count === 0) throw new NotFoundException('Contact not found');
    return { message: 'Contact deleted' };
  }
}
