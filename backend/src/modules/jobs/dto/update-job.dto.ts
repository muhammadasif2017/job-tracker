import { PartialType } from '@nestjs/swagger';
import { CreateJobDto } from './create-job.dto.js';

/** Body for editing a job; send `null` to clear a nullable field. */
export class UpdateJobDto extends PartialType(CreateJobDto) {}
