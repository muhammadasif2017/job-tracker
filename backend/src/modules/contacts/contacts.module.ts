import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service.js';
import {
  ContactsController,
  CompanyContactsController,
} from './contacts.controller.js';

/** Contacts, reachable under both a job and a company (ADR-022). */
@Module({
  providers: [ContactsService],
  controllers: [ContactsController, CompanyContactsController],
})
export class ContactsModule {}
