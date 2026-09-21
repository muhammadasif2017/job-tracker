import { UpdateJobDto } from './dto/update-job.dto.js';
import { civilDateFromInput } from './jobs-dates.helper.js';

/**
 * The plain field writes shared by every update path. Status is
 * deliberately absent: it is either unchanged, and there is nothing to
 * write, or it is changing, and the compare-and-swap branch in
 * `JobsService.update` owns it.
 */
export function buildUpdateData(dto: UpdateJobDto) {
  return {
    company: dto.company,
    position: dto.position,
    location: dto.location,
    url: dto.url,
    jobType: dto.jobType,
    discoverySource: dto.discoverySource,
    applicationChannel: dto.applicationChannel,
    notes: dto.notes,
    appliedAt: dto.appliedAt ? civilDateFromInput(dto.appliedAt) : undefined,
  };
}
