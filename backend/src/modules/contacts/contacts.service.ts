import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';

// Soft cap, not a real-world limit — a legitimate job search or company
// research effort doesn't produce dozens of contacts for one job/company.
// Guards against unbounded Contact growth from a scripted client, not a
// security boundary (contacts are already scoped to the owning user).
const MAX_CONTACTS_PER_PARENT = 20;

// A contact belongs to exactly one parent — which one is determined by
// which controller/route the caller hit (jobs/:jobId/contacts vs.
// companies/:companyId/contacts), never by client-supplied data. Every
// method below takes this as the sole source of truth for both the
// ownership check and which FK gets written.
type ContactParentRef = { jobId: string } | { companyId: string };

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  /**
   * The only authorization check in this module. `Contact` carries no `userId`
   * column of its own (ADR-022), so ownership is always derived from whichever
   * parent the route named. A parent owned by another user is reported as a
   * plain 404, same as one that does not exist, so an id's existence does not
   * leak.
   */
  private async ensureOwner(userId: string, ref: ContactParentRef) {
    if ('jobId' in ref) {
      const job = await this.prisma.job.findFirst({
        where: { id: ref.jobId, userId },
        select: { id: true },
      });
      if (!job) throw new NotFoundException('Job not found');
      return;
    }
    const company = await this.prisma.company.findFirst({
      where: { id: ref.companyId, userId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Company not found');
  }

  /**
   * The count check and the insert are deliberately not transactional — the
   * cap is a soft guard against runaway growth, not an invariant, so a
   * concurrent pair of creates landing at 21 rows is an acceptable outcome.
   */
  async create(userId: string, ref: ContactParentRef, dto: CreateContactDto) {
    await this.ensureOwner(userId, ref);
    const existingCount = await this.prisma.contact.count({ where: ref });
    if (existingCount >= MAX_CONTACTS_PER_PARENT) {
      throw new BadRequestException(
        `A ${'jobId' in ref ? 'job' : 'company'} can have at most ${MAX_CONTACTS_PER_PARENT} contacts`,
      );
    }
    return this.prisma.contact.create({
      data: {
        ...ref,
        name: dto.name,
        role: dto.role,
        email: dto.email,
        phone: dto.phone,
        linkedinUrl: dto.linkedinUrl,
        notes: dto.notes,
      },
    });
  }

  /**
   * Lists every contact under one parent, oldest first so the order stays
   * stable as the user adds more.
   */
  async findAllFor(userId: string, ref: ContactParentRef) {
    await this.ensureOwner(userId, ref);
    return this.prisma.contact.findMany({
      where: ref,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Every optional field is written through unconditionally, including as
   * `null`. `UpdateContactDto` types them `T | null` and the frontend sends an
   * explicit `null` for a field the user emptied — Prisma treats an omitted
   * key as "leave the column alone", so only an explicit `null` clears it
   * (ADR-022).
   *
   * The pre-read exists to distinguish "not found" from "belongs to a
   * different parent": the update itself is keyed on the contact id alone, so
   * the `...ref` in the lookup is what binds it to the parent just authorized.
   */
  async update(
    userId: string,
    ref: ContactParentRef,
    contactId: string,
    dto: UpdateContactDto,
  ) {
    await this.ensureOwner(userId, ref);
    const existing = await this.prisma.contact.findFirst({
      where: { id: contactId, ...ref },
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

  /**
   * A single scoped `deleteMany` rather than a read-then-delete: `count === 0`
   * already covers both "no such contact" and "not under this parent", so the
   * extra round trip would buy nothing.
   */
  async remove(userId: string, ref: ContactParentRef, contactId: string) {
    await this.ensureOwner(userId, ref);
    const { count } = await this.prisma.contact.deleteMany({
      where: { id: contactId, ...ref },
    });
    if (count === 0) throw new NotFoundException('Contact not found');
    return { message: 'Contact deleted' };
  }
}
