'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Eye, Download, Trash2, Upload } from 'lucide-react';
import { Button } from '../ui/button';
import api from '../../lib/api';
import {
  useResumeQuery,
  useUploadResumeMutation,
  useRemoveResumeMutation,
} from '../../features/jobs/resume.hooks';
import type { Resume } from '../../types';

const MAX_SIZE = 8 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The resume URL comes in two shapes, by backend STORAGE_DRIVER:
// - local: our own auth-gated `/jobs/resumes/file` endpoint, which needs the
//   Bearer header only the `api` client attaches (a bare fetch gets a 401).
// - oracle: a presigned object-storage URL, fetched without that header,
//   which the storage service would reject alongside the URL signature.
// Either way a non-OK response is an error, never a file to save.
function isApiUrl(url: string): boolean {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  return Boolean(apiUrl && url.startsWith(apiUrl));
}

async function fetchResumeBlob(url: string): Promise<Blob> {
  if (isApiUrl(url)) {
    const { data } = await api.get<Blob>(url, { responseType: 'blob' });
    return data;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Resume download failed with ${response.status}`);
  }
  return response.blob();
}

interface ResumeUploadProps {
  jobId: string | null;
  initialResume?: Resume | null;
}

export function ResumeUpload({ jobId, initialResume }: ResumeUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const { data: resume } = useResumeQuery(jobId, initialResume);
  const uploadMutation = useUploadResumeMutation(jobId);
  const removeMutation = useRemoveResumeMutation(jobId, () =>
    setConfirming(false),
  );

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
      if (!isApiUrl(data.url)) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        return;
      }
      // A new tab can't send the Bearer token the local-driver endpoint
      // needs, so open an authenticated blob instead. Revoked after a delay:
      // the new tab loads the blob URL asynchronously.
      const objectUrl = URL.createObjectURL(await fetchResumeBlob(data.url));
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      toast.error('Could not open file');
    }
  }

  async function handleDownload() {
    if (!resume) return;
    setIsDownloading(true);
    try {
      const { data } = await api.get(`/jobs/${jobId}/resumes/url`);
      const blob = await fetchResumeBlob(data.url);
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
    <div className="flex flex-col gap-2">
      <label className="font-mono text-xs font-medium uppercase tracking-wide text-muted">
        Resume
      </label>

      {resume ? (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-paper-raised px-3 py-2 sm:flex-row sm:items-center">
          <FileText className="hidden h-5 w-5 shrink-0 text-danger sm:block" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">
              {resume.originalName}
            </p>
            <p className="text-xs text-muted">{formatBytes(resume.size)}</p>
          </div>

          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">Remove resume?</span>
              <Button
                type="button"
                variant="danger"
                size="sm"
                loading={removeMutation.isPending}
                onClick={() => removeMutation.mutate()}
              >
                Yes
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                No
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleView}
              >
                <Eye className="h-4 w-4" />
                View
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={isDownloading}
                onClick={handleDownload}
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-danger hover:bg-danger-soft hover:text-danger"
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
