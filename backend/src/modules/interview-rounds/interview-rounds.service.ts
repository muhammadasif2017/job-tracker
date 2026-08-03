import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  JobStatus,
  JobEventType,
  InterviewOutcome,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateInterviewRoundDto } from './dto/create-interview-round.dto.js';
import { UpdateInterviewRoundDto } from './dto/update-interview-round.dto.js';

// Soft cap, not a real-world limit — a legitimate job search doesn't produce
// hundreds of rounds for one job. Guards against unbounded InterviewRound/
// JobEvent growth from a scripted client, not a security boundary (rounds
// are already scoped to the owning user).
const MAX_ROUNDS_PER_JOB = 50;

@Injectable()
export class InterviewRoundsService {
  constructor(private prisma: PrismaService) {}

  private async ensureJobOwned(userId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId },
      select: { id: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  // Every round logs a Timeline entry. If the job is still APPLIED, scheduling
  // a round is a real-world signal it's moved past "applied" — promote to
  // INTERVIEWING (never override a deliberate OFFER/REJECTED/GHOSTED/WISHLIST
  // status).
  //
  // The promotion is a conditional updateMany (status = APPLIED) rather than
  // an unconditional update, so it doubles as a compare-and-swap: if two round
  // creations race on the same APPLIED job, only one updateMany matches a row
  // and writes the STATUS_CHANGE event — the loser sees count === 0 and logs
  // a plain INTERVIEW_ROUND_ADDED event instead of promoting (and
  // double-logging) again. This is why the event isn't nested inside the job
  // mutation here, unlike the normal "same Prisma operation" pattern
  // (see backend CLAUDE.md, "Jobs: Event Logging") — updateMany can't carry a
  // nested create, so both statements run inside the caller's transaction
  // instead.
  private async logRoundEvent(
    tx: Prisma.TransactionClient,
    jobId: string,
    stage: string,
  ) {
    const { count } = await tx.job.updateMany({
      where: { id: jobId, status: JobStatus.APPLIED },
      data: { status: JobStatus.INTERVIEWING },
    });
    if (count > 0) {
      await tx.jobEvent.create({
        data: {
          jobId,
          type: JobEventType.STATUS_CHANGE,
          fromStatus: JobStatus.APPLIED,
          toStatus: JobStatus.INTERVIEWING,
          note: stage,
        },
      });
      return;
    }
    const job = await tx.job.findUniqueOrThrow({
      where: { id: jobId },
      select: { status: true },
    });
    await tx.jobEvent.create({
      data: {
        jobId,
        type: JobEventType.INTERVIEW_ROUND_ADDED,
        toStatus: job.status,
        note: stage,
      },
    });
  }

  // Recomputes Job.nextInterviewAt from the earliest future PENDING round.
  // Called after every create/update/delete so it's always the single source
  // of truth — never set directly via CreateJobDto/UpdateJobDto. Always runs
  // inside the same transaction as the round mutation that triggered it.
  //
  // This is a single UPDATE with the MIN(...) subquery inline, not a
  // findFirst-then-update round trip — two concurrent round mutations on the
  // same job would otherwise be a lost-update race (both read the pre-update
  // round set, second write clobbers the first with a stale value). A single
  // statement forces Postgres to serialize on the job row and re-evaluate the
  // subquery fresh for each writer, closing the window findFirst-then-update
  // left open (see ADR-018's "Known Remaining Gap").
  //
  // `scheduledAt` is TIMESTAMP(3) — no time zone (see the interview_rounds
  // migration). SQL `now()` returns timestamptz, and comparing a naive
  // timestamp column to it resolves against the session TimeZone setting —
  // correct on this UTC dev container, silently wrong on any DB whose
  // session timezone isn't UTC. Binding a JS Date as a parameter instead
  // sidesteps that: Prisma serializes it the same way it did for the old
  // `scheduledAt: { gte: new Date() }` query-builder call, so this restores
  // the exact prior (timezone-independent) semantics.
  private async recomputeNextInterviewAt(
    tx: Prisma.TransactionClient,
    jobId: string,
  ) {
    const now = new Date();
    await tx.$executeRaw`
      UPDATE "Job"
      SET "nextInterviewAt" = (
        SELECT MIN("scheduledAt") FROM "interview_rounds"
        WHERE "jobId" = ${jobId} AND "outcome" = 'PENDING' AND "scheduledAt" >= ${now}
      )
      WHERE "id" = ${jobId}
    `;
  }

  async create(userId: string, jobId: string, dto: CreateInterviewRoundDto) {
    await this.ensureJobOwned(userId, jobId);
    const existingCount = await this.prisma.interviewRound.count({
      where: { jobId },
    });
    if (existingCount >= MAX_ROUNDS_PER_JOB) {
      throw new BadRequestException(
        `A job can have at most ${MAX_ROUNDS_PER_JOB} interview rounds`,
      );
    }
    // The round insert, event log, and nextInterviewAt recompute share one
    // transaction — a mid-sequence failure must not leave an orphaned round
    // with no Timeline event, or a stale nextInterviewAt.
    return this.prisma.$transaction(async (tx) => {
      const round = await tx.interviewRound.create({
        data: {
          jobId,
          stage: dto.stage,
          scheduledAt: new Date(dto.scheduledAt),
          notes: dto.notes,
        },
      });
      await this.logRoundEvent(tx, jobId, dto.stage);
      await this.recomputeNextInterviewAt(tx, jobId);
      return round;
    });
  }

  async findAllForJob(userId: string, jobId: string) {
    await this.ensureJobOwned(userId, jobId);
    return this.prisma.interviewRound.findMany({
      where: { jobId },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async update(
    userId: string,
    jobId: string,
    roundId: string,
    dto: UpdateInterviewRoundDto,
  ) {
    await this.ensureJobOwned(userId, jobId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.interviewRound.findFirst({
        where: { id: roundId, jobId },
        select: { id: true, outcome: true },
      });
      if (!existing) throw new NotFoundException('Interview round not found');

      // A reminder already sent is no longer valid once the round is moved
      // (new time) or un-cancelled (e.g. CANCELLED -> PENDING) — clear the
      // flag so the scheduler picks it up again instead of skipping it forever.
      const reschedule = Boolean(dto.scheduledAt);
      const uncancelled =
        dto.outcome === InterviewOutcome.PENDING &&
        existing.outcome !== InterviewOutcome.PENDING;

      const round = await tx.interviewRound.update({
        where: { id: roundId },
        data: {
          stage: dto.stage,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
          outcome: dto.outcome,
          notes: dto.notes,
          ...(reschedule || uncancelled ? { reminderSentAt: null } : {}),
        },
      });
      await this.recomputeNextInterviewAt(tx, jobId);
      return round;
    });
  }

  async remove(userId: string, jobId: string, roundId: string) {
    await this.ensureJobOwned(userId, jobId);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.interviewRound.deleteMany({
        where: { id: roundId, jobId },
      });
      if (count === 0) throw new NotFoundException('Interview round not found');

      await this.recomputeNextInterviewAt(tx, jobId);
      return { message: 'Interview round deleted' };
    });
  }

  // RFC 5545 §3.3.11 TEXT escaping — backslash first so it doesn't double-escape
  // the characters escaped after it.
  private escapeIcsText(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // scheduledAt is TIMESTAMP(3) with no time zone, always written/compared as
  // UTC elsewhere (see recomputeNextInterviewAt) — format with a Z suffix to
  // match that assumption rather than the server's local time zone. Only
  // used for DTSTAMP now (when this file was generated) — DTSTART/DTEND use
  // formatIcsDateOnly below.
  private formatIcsDate(date: Date): string {
    return date
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
  }

  // scheduledAt is date-only in intent (the form only ever offers a bare
  // date picker, no time-of-day input) but stored as a UTC-midnight
  // instant. Reading it back as a timed UTC instant — as formatIcsDate does
  // — makes calendar apps convert it to the viewer's local time, shifting
  // the event to the wrong day for anyone outside UTC. Reading the UTC
  // calendar-date components instead and emitting an RFC 5545 all-day date
  // value (VALUE=DATE, no time/zone) keeps the calendar day the user picked
  // regardless of the viewer's time zone.
  private formatIcsDateOnly(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  // RFC 5545 §3.1: content lines must be folded at 75 octets (excluding the
  // CRLF). company/position/notes are user text up to 5000 chars, so SUMMARY
  // and DESCRIPTION routinely blow past that — an unfolded line risks
  // rejection or truncation in strict .ics parsers. Folds on UTF-8 octet
  // boundaries (never splitting a multi-byte character) since the limit is
  // defined in octets, not characters; each continuation line loses 1 octet
  // of budget to the mandatory leading space.
  private foldIcsLine(line: string): string {
    const bytes = Buffer.from(line, 'utf8');
    if (bytes.length <= 75) return line;

    const chunks: string[] = [];
    let start = 0;
    let limit = 75;
    while (start < bytes.length) {
      let end = Math.min(start + limit, bytes.length);
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
      chunks.push(bytes.subarray(start, end).toString('utf8'));
      start = end;
      limit = 74;
    }
    return chunks.join('\r\n ');
  }

  async exportIcs(
    userId: string,
    jobId: string,
    roundId: string,
  ): Promise<{ filename: string; content: string }> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId },
      select: { company: true, position: true },
    });
    if (!job) throw new NotFoundException('Job not found');

    const round = await this.prisma.interviewRound.findFirst({
      where: { id: roundId, jobId },
    });
    if (!round) throw new NotFoundException('Interview round not found');

    const start = round.scheduledAt;
    // All-day event: RFC 5545 DTEND is exclusive, so a single calendar day
    // ends the day after it starts.
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const summary = this.escapeIcsText(
      `${round.stage} — ${job.company} (${job.position})`,
    );
    const descriptionParts = [`Position: ${job.position}`];
    if (round.notes) descriptionParts.push(`Notes: ${round.notes}`);
    const description = this.escapeIcsText(descriptionParts.join('\n'));

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//job-tracker//interview-rounds//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${round.id}@job-tracker`,
      `DTSTAMP:${this.formatIcsDate(new Date())}`,
      `DTSTART;VALUE=DATE:${this.formatIcsDateOnly(start)}`,
      `DTEND;VALUE=DATE:${this.formatIcsDateOnly(end)}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    return {
      filename: `interview-${round.stage.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`,
      // ICS requires CRLF line endings.
      content: lines.map((l) => this.foldIcsLine(l)).join('\r\n'),
    };
  }
}
