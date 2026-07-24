import { Injectable, NotFoundException } from '@nestjs/common';
import { InterviewOutcome, JobStatus, JobEventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateInterviewRoundDto } from './dto/create-interview-round.dto.js';
import { UpdateInterviewRoundDto } from './dto/update-interview-round.dto.js';

@Injectable()
export class InterviewRoundsService {
  constructor(private prisma: PrismaService) {}

  private async ensureJobOwned(userId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId },
      select: { id: true, status: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  // Every round logs a Timeline entry. If the job is still APPLIED, scheduling
  // a round is a real-world signal it's moved past "applied" — promote to
  // INTERVIEWING (never override a deliberate OFFER/REJECTED/GHOSTED/WISHLIST
  // status). Otherwise just log the round itself, since the job already
  // reflects (or intentionally diverges from) the interviewing state.
  private async logRoundEvent(
    jobId: string,
    currentStatus: JobStatus,
    stage: string,
  ) {
    if (currentStatus === JobStatus.APPLIED) {
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.INTERVIEWING,
          events: {
            create: {
              type: JobEventType.STATUS_CHANGE,
              fromStatus: JobStatus.APPLIED,
              toStatus: JobStatus.INTERVIEWING,
              note: stage,
            },
          },
        },
      });
      return;
    }
    await this.prisma.jobEvent.create({
      data: {
        jobId,
        type: JobEventType.INTERVIEW_ROUND_ADDED,
        toStatus: currentStatus,
        note: stage,
      },
    });
  }

  // Recomputes Job.nextInterviewAt from the earliest future PENDING round.
  // Called after every create/update/delete so it's always the single source
  // of truth — never set directly via CreateJobDto/UpdateJobDto.
  private async recomputeNextInterviewAt(jobId: string) {
    const next = await this.prisma.interviewRound.findFirst({
      where: {
        jobId,
        outcome: InterviewOutcome.PENDING,
        scheduledAt: { gte: new Date() },
      },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true },
    });
    await this.prisma.job.update({
      where: { id: jobId },
      data: { nextInterviewAt: next?.scheduledAt ?? null },
    });
  }

  async create(userId: string, jobId: string, dto: CreateInterviewRoundDto) {
    const job = await this.ensureJobOwned(userId, jobId);
    const round = await this.prisma.interviewRound.create({
      data: {
        jobId,
        stage: dto.stage,
        scheduledAt: new Date(dto.scheduledAt),
        notes: dto.notes,
      },
    });
    await this.logRoundEvent(jobId, job.status, dto.stage);
    await this.recomputeNextInterviewAt(jobId);
    return round;
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
    const existing = await this.prisma.interviewRound.findFirst({
      where: { id: roundId, jobId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Interview round not found');

    const round = await this.prisma.interviewRound.update({
      where: { id: roundId },
      data: {
        stage: dto.stage,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        outcome: dto.outcome,
        notes: dto.notes,
      },
    });
    await this.recomputeNextInterviewAt(jobId);
    return round;
  }

  async remove(userId: string, jobId: string, roundId: string) {
    await this.ensureJobOwned(userId, jobId);
    const { count } = await this.prisma.interviewRound.deleteMany({
      where: { id: roundId, jobId },
    });
    if (count === 0) throw new NotFoundException('Interview round not found');

    await this.recomputeNextInterviewAt(jobId);
    return { message: 'Interview round deleted' };
  }
}
