import { Injectable, NotFoundException } from '@nestjs/common';
import {
  InterviewOutcome,
  JobStatus,
  JobEventType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateInterviewRoundDto } from './dto/create-interview-round.dto.js';
import { UpdateInterviewRoundDto } from './dto/update-interview-round.dto.js';

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
  // inside the same transaction as the round mutation that triggered it, so a
  // concurrent request can't observe a half-committed round set.
  private async recomputeNextInterviewAt(
    tx: Prisma.TransactionClient,
    jobId: string,
  ) {
    const next = await tx.interviewRound.findFirst({
      where: {
        jobId,
        outcome: InterviewOutcome.PENDING,
        scheduledAt: { gte: new Date() },
      },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true },
    });
    await tx.job.update({
      where: { id: jobId },
      data: { nextInterviewAt: next?.scheduledAt ?? null },
    });
  }

  async create(userId: string, jobId: string, dto: CreateInterviewRoundDto) {
    await this.ensureJobOwned(userId, jobId);
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
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Interview round not found');

      const round = await tx.interviewRound.update({
        where: { id: roundId },
        data: {
          stage: dto.stage,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
          outcome: dto.outcome,
          notes: dto.notes,
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
}
