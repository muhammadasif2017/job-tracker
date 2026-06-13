'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Eye, Download, Trash2, Upload } from 'lucide-react';
import { Button } from '../ui/button';
import { isAxiosError } from 'axios';
import api from '../../lib/api';
import type { Resume } from '../../types';

const MAX_SIZE = 8 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ResumeUploadProps {
  jobId: string | null;
  initialResume?: Resume | null;
}

export function ResumeUpload({ jobId, initialResume }: ResumeUploadProps) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [initialTimestamp] = useState<number | undefined>(() =>
    initialResume !== undefined ? Date.now() : undefined,
  );

  const { data: resume } = useQuery<Resume | null>({
    queryKey: ['resume', jobId],
    queryFn: () => api.get(`/jobs/${jobId}/resumes`).then((r) => r.data),
    initialData: initialResume !== undefined ? initialResume : undefined,
    initialDataUpdatedAt: initialTimestamp,
    enabled: !!jobId,
    staleTime: 60_000,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api
        .post(`/jobs/${jobId}/resumes`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data);
    },
    onSuccess: (data: Resume) => {
      qc.setQueryData(['resume', jobId], data);
      toast.success('Resume uploaded');
    },
    onError: (err: unknown) =>
      toast.error(
        isAxiosError(err)
          ? (err.response?.data?.message ?? 'Upload failed')
          : 'Upload failed',
      ),
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete(`/jobs/${jobId}/resumes`).then((r) => r.data),
    onSuccess: () => {
      qc.setQueryData(['resume', jobId], null);
      setConfirming(false);
      toast.success('Resume removed');
    },
    onError: (err: unknown) => {
      setConfirming(false);
      toast.error(
        isAxiosError(err)
          ? (err.response?.data?.message ?? 'Remove failed')
          : 'Remove failed',
      );
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.type !== 'application/pdf') {
      toast.error('Only PDF files are allowed');
      return;
    }
    if (file.size > MAX_SIZE) {
      toast.error('File must be under 8 MB');
      return;
    }

    uploadMutation.mutate(file);
  }

  async function handleView() {
    try {
      const { data } = await api.get(`/jobs/${jobId}/resumes/url`);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Could not open file');
    }
  }

  async function handleDownload() {
    if (!resume) return;
    setIsDownloading(true);
    try {
      const { data } = await api.get(`/jobs/${jobId}/resumes/url`);
      const response = await fetch(data.url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = resume.originalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      toast.error('Download failed');
    } finally {
      setIsDownloading(false);
    }
  }

  if (!jobId) return null;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
        Resume
      </label>

      {resume ? (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
          <FileText className="h-5 w-5 shrink-0 text-red-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
              {resume.originalName}
            </p>
            <p className="text-xs text-slate-500">{formatBytes(resume.size)}</p>
          </div>

          {confirming ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-sm text-slate-600 dark:text-slate-400">
                Remove resume?
              </span>
              <Button
                variant="danger"
                size="sm"
                loading={removeMutation.isPending}
                onClick={() => removeMutation.mutate()}
              >
                Yes
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                No
              </Button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" onClick={handleView}>
                <Eye className="h-4 w-4" />
                View
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={isDownloading}
                onClick={handleDownload}
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={uploadMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            Attach Resume (PDF, max 8 MB)
          </Button>
        </>
      )}
    </div>
  );
}
