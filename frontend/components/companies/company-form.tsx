'use client';

import { useForm } from 'react-hook-form';
import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sparkles } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';
import { EnrichmentStatusBadge } from '../ui/badge';
import {
  COMPANY_CITIES,
  CITY_LABELS,
  JOB_PRIORITIES,
  PRIORITY_LABELS,
  BUSINESS_MODES,
  BUSINESS_MODE_LABELS,
  type Company,
} from '../../types';
import {
  useCreateCompanyMutation,
  useUpdateCompanyMutation,
  useCompanyEnrichmentMutation,
} from '../../features/companies/hooks';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  city: z.enum(COMPANY_CITIES),
  location: z.string().optional(),
  priority: z.enum(JOB_PRIORITIES),
  personalNotes: z.string().optional(),
  websiteUrl: z
    .string()
    .url('Enter a valid URL')
    .or(z.literal(''))
    .optional(),
  linkedinUrl: z
    .string()
    .url('Enter a valid URL')
    .or(z.literal(''))
    .optional(),
  businessMode: z.enum(BUSINESS_MODES).or(z.literal('')).optional(),
  productDescription: z.string().optional(),
  industry: z.string().optional(),
  companySize: z.string().optional(),
  techStack: z.string().optional(),
  cultureSummary: z.string().optional(),
  workPolicy: z.string().optional(),
  workLifeBalance: z.string().optional(),
  headquarters: z.string().optional(),
  address: z.string().optional(),
  founded: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

interface CompanyFormProps {
  open: boolean;
  onClose: () => void;
  company?: Company;
}

export function CompanyForm({ open, onClose, company }: CompanyFormProps) {
  const isEdit = !!company;
  const [confirmRefresh, setConfirmRefresh] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { city: 'LAHORE', priority: 'MEDIUM' },
  });

  useEffect(() => {
    if (open) {
      reset(
        company
          ? {
              name: company.name,
              city: company.city,
              location: company.location ?? '',
              priority: company.priority,
              personalNotes: company.personalNotes ?? '',
              websiteUrl: company.websiteUrl ?? '',
              linkedinUrl: company.linkedinUrl ?? '',
              businessMode: company.businessMode ?? '',
              productDescription: company.productDescription ?? '',
              industry: company.industry ?? '',
              companySize: company.companySize ?? '',
              techStack: company.techStack.join(', '),
              cultureSummary: company.cultureSummary ?? '',
              workPolicy: company.workPolicy ?? '',
              workLifeBalance: company.workLifeBalance ?? '',
              headquarters: company.headquarters ?? '',
              address: company.address ?? '',
              founded: company.founded ?? '',
            }
          : { city: 'LAHORE', priority: 'MEDIUM' },
      );
    }
  }, [open, company, reset]);

  // Reset on close (not open) — avoids a setState-in-effect cascade, and
  // covers every close path (Cancel/X/backdrop/successful submit) so the
  // confirm dialog never carries stale state into the next open.
  const handleClose = () => {
    setConfirmRefresh(false);
    onClose();
  };

  const createMutation = useCreateCompanyMutation(() => {
    reset();
    handleClose();
  });
  const updateMutation = useUpdateCompanyMutation(company?.id ?? '', () => {
    handleClose();
  });
  const enrichMutation = useCompanyEnrichmentMutation(company?.id ?? '');

  const onSubmit = (data: FormData) => {
    const payload = {
      ...data,
      location: data.location || null,
      personalNotes: data.personalNotes || null,
      websiteUrl: data.websiteUrl || null,
      linkedinUrl: data.linkedinUrl || null,
      businessMode: data.businessMode || null,
      productDescription: data.productDescription || null,
      industry: data.industry || null,
      companySize: data.companySize || null,
      techStack: data.techStack
        ? data.techStack.split(',').map((t) => t.trim()).filter(Boolean)
        : [],
      cultureSummary: data.cultureSummary || null,
      workPolicy: data.workPolicy || null,
      workLifeBalance: data.workLifeBalance || null,
      headquarters: data.headquarters || null,
      address: data.address || null,
      founded: data.founded || null,
    };
    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const mutation = isEdit ? updateMutation : createMutation;
  const enrichmentInFlight =
    company?.status === 'PENDING' || company?.status === 'PROCESSING';

  const triggerEnrichment = () => {
    if (company?.status === 'COMPLETED') {
      setConfirmRefresh(true);
    } else {
      enrichMutation.mutate();
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={isEdit ? 'Edit Target Company' : 'Add Target Company'}
      >
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name *"
              placeholder="Systems Limited"
              error={errors.name?.message}
              {...register('name')}
            />
            <div className="flex flex-col gap-1">
              <label
                htmlFor="company-city"
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                City
              </label>
              <select
                id="company-city"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                {...register('city')}
              >
                {COMPANY_CITIES.map((c) => (
                  <option key={c} value={c}>
                    {CITY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Location detail"
              placeholder="DHA Phase 5, Lahore"
              {...register('location')}
            />
            <div className="flex flex-col gap-1">
              <label
                htmlFor="company-priority"
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Priority
              </label>
              <select
                id="company-priority"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                {...register('priority')}
              >
                {JOB_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="company-business-mode"
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Business Mode
              </label>
              <select
                id="company-business-mode"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                {...register('businessMode')}
              >
                <option value="">—</option>
                {BUSINESS_MODES.map((b) => (
                  <option key={b} value={b}>
                    {BUSINESS_MODE_LABELS[b]}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Founded"
              placeholder="2005"
              {...register('founded')}
            />
          </div>

          <Input
            label="Website"
            type="url"
            placeholder="https://..."
            error={errors.websiteUrl?.message}
            {...register('websiteUrl')}
          />
          <Input
            label="LinkedIn"
            type="url"
            placeholder="https://www.linkedin.com/company/..."
            error={errors.linkedinUrl?.message}
            {...register('linkedinUrl')}
          />
          <Input
            label="What do they build/offer?"
            placeholder="IT staff augmentation for US clients"
            {...register('productDescription')}
          />

          {isEdit && (
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    AI Research
                  </span>
                  <EnrichmentStatusBadge status={company!.status} />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={enrichmentInFlight}
                  loading={enrichMutation.isPending}
                  onClick={triggerEnrichment}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {company!.status === 'COMPLETED' ? 'Refresh' : 'Research'}
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Industry" {...register('industry')} />
                <Input
                  label="Company Size"
                  placeholder="50-200 employees"
                  {...register('companySize')}
                />
                <Input
                  label="Work Policy"
                  placeholder="Hybrid"
                  {...register('workPolicy')}
                />
                <Input
                  label="Work-Life Balance"
                  placeholder="Good"
                  {...register('workLifeBalance')}
                />
                <Input label="Headquarters" {...register('headquarters')} />
                <Input label="Address" {...register('address')} />
              </div>
              <div className="mt-4 flex flex-col gap-1">
                <label
                  htmlFor="company-tech-stack"
                  className="text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Tech Stack (comma-separated)
                </label>
                <input
                  id="company-tech-stack"
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  placeholder="React, Node.js, AWS"
                  {...register('techStack')}
                />
              </div>
              <div className="mt-4 flex flex-col gap-1">
                <label
                  htmlFor="company-culture"
                  className="text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Culture Summary
                </label>
                <textarea
                  id="company-culture"
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  {...register('cultureSummary')}
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label
              htmlFor="company-notes"
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Your notes
            </label>
            <textarea
              id="company-notes"
              rows={3}
              placeholder="Why you'd want to work here, impressions, contacts you know…"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              {...register('personalNotes')}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? 'Save changes' : 'Add company'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={confirmRefresh}
        onClose={() => setConfirmRefresh(false)}
        title="Refresh AI research?"
        description="This will overwrite industry, tech stack, culture, and other researched fields — any manual corrections you made to them will be replaced."
      >
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => setConfirmRefresh(false)}>
            Cancel
          </Button>
          <Button
            loading={enrichMutation.isPending}
            onClick={() => {
              setConfirmRefresh(false);
              enrichMutation.mutate();
            }}
          >
            Refresh anyway
          </Button>
        </div>
      </Modal>
    </>
  );
}
