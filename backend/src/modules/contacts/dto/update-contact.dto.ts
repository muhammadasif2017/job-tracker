import { PartialType } from '@nestjs/swagger';
import { CreateContactDto } from './create-contact.dto.js';

/** Body for editing a contact; send `null` to clear a field. */
export class UpdateContactDto extends PartialType(CreateContactDto) {}
