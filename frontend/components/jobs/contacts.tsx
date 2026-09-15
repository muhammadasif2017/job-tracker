'use client';

import { ContactsPanel } from '../contacts/contacts-panel';
import {
  useCreateContactMutation,
  useUpdateContactMutation,
  useRemoveContactMutation,
} from '../../features/jobs/contacts.hooks';
import type { Contact } from '../../types';

interface ContactsProps {
  jobId: string;
  contacts: Contact[];
}

export function Contacts({ jobId, contacts }: ContactsProps) {
  return (
    <ContactsPanel
      contacts={contacts}
      createMutation={useCreateContactMutation(jobId)}
      updateMutation={useUpdateContactMutation(jobId)}
      removeMutation={useRemoveContactMutation(jobId)}
      title="Contacts"
      variant="section"
      notesInputId="contact-notes"
      placeholders={{
        role: 'Recruiter',
        email: 'jane.doe@example.com',
        phone: '+1 555 123 4567',
        notes: 'Met at the referral call',
      }}
    />
  );
}
