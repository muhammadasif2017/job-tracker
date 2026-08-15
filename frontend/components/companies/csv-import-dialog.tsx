'use client';

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { useImportCompaniesCsvMutation } from '../../features/companies/hooks';
import type { CsvImportResult } from '../../types';

interface CsvImportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CsvImportDialog({ open, onClose }: CsvImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<CsvImportResult | null>(null);

  const importMutation = useImportCompaniesCsvMutation((r) => setResult(r));

  const handleClose = () => {
    setSelectedFile(null);
    setResult(null);
    onClose();
  };

  const handleImport = () => {
    if (selectedFile) importMutation.mutate(selectedFile);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import Companies from CSV"
      description='Header row must be exactly "name,city,businessMode". businessMode is optional per row.'
    >
      <div className="space-y-4">
        {!result && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-300"
            />
            <p className="text-xs text-slate-400">
              Example: <code>Systems Limited,LAHORE,SERVICES</code>
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                disabled={!selectedFile}
                loading={importMutation.isPending}
                onClick={handleImport}
              >
                <Upload className="h-3.5 w-3.5" /> Import
              </Button>
            </div>
          </>
        )}

        {result && (
          <>
            <p className="text-sm">
              Imported{' '}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {result.imported}
              </span>{' '}
              compan{result.imported === 1 ? 'y' : 'ies'}
              {result.errors.length > 0 && (
                <>
                  , skipped{' '}
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    {result.errors.length}
                  </span>{' '}
                  row{result.errors.length === 1 ? '' : 's'}
                </>
              )}
              .
            </p>

            {result.errors.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-xs">
                  <thead className="border-b bg-slate-50 dark:bg-slate-800/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-500">
                        Row
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-slate-500">
                        Error
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {result.errors.map((e) => (
                      <tr key={e.row}>
                        <td className="px-3 py-2 text-slate-500">{e.row}</td>
                        <td className="px-3 py-2 break-words">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={handleClose}>Done</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
