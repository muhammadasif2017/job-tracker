import { cn } from '../../lib/utils';
import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, InputHTMLAttributes, useState } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, type, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    const isPassword = type === 'password';
    const [visible, setVisible] = useState(false);
    const errorId = error && inputId ? `${inputId}-error` : undefined;
    const hintId = hint && !error && inputId ? `${inputId}-hint` : undefined;
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={inputId}
            className="font-mono text-xs font-medium uppercase tracking-wide text-muted"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type={isPassword && visible ? 'text' : type}
            aria-invalid={!!error}
            aria-describedby={errorId ?? hintId}
            className={cn(
              'h-9 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink placeholder:text-muted-2',
              'transition-colors outline-none',
              'focus:border-accent focus:ring-2 focus:ring-accent/20',
              error && 'border-danger focus:border-danger focus:ring-danger/20',
              isPassword && 'pr-9',
              className,
            )}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setVisible((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-2 hover:text-ink"
              aria-label={visible ? 'Hide password' : 'Show password'}
            >
              {visible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}
        </div>
        {error && (
          <p id={errorId} className="text-xs text-danger">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={hintId} className="text-xs text-muted">
            {hint}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';
