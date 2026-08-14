import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service.js';
import {
  ContactsController,
  CompanyContactsController,
} from './contacts.controller.js';

@Module({
  providers: [ContactsService],
  controllers: [ContactsController, CompanyContactsController],
})
export class ContactsModule {}
