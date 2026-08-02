import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service.js';
import { ContactsController } from './contacts.controller.js';

@Module({
  providers: [ContactsService],
  controllers: [ContactsController],
})
export class ContactsModule {}
