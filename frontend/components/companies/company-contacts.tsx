'use client';

import { ContactsPanel } from '../contacts/contacts-panel';
import {
  useCreateCompanyContactMutation,
  useUpdateCompanyContactMutation,
  useRemoveCompanyContactMutation,
} from '../../features/companies/hooks';
import type { Contact } from '../../types';

interface CompanyContactsProps {
  companyId: string;
  contacts: Contact[];
}

export function CompanyContacts({ companyId, contacts }: CompanyContactsProps) {
  return (
    <ContactsPanel
      contacts={contacts}
      createMutation={useCreateCompanyContactMutation(companyId)}
      updateMutation={useUpdateCompanyContactMutation(companyId)}
      removeMutation={useRemoveCompanyContactMutation(companyId)}
      title="HR / Company Contacts"
      variant="nested"
      notesInputId="company-contact-notes"
      placeholders={{
        role: 'Talent Acquisition',
        email: 'hr@company.com',
        phone: '+92 300 1234567',
        notes: 'Met at a career fair',
      }}
    />
  );
}
