import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { TimezoneField } from './timezone-field';

function Harness({ onUseBrowserTimezone }: { onUseBrowserTimezone: (tz: string) => void }) {
  const { register } = useForm<{ timezone: string }>({
    defaultValues: { timezone: 'UTC' },
  });
  return (
    <TimezoneField
      registerProps={register('timezone')}
      onUseBrowserTimezone={onUseBrowserTimezone}
    />
  );
}

describe('TimezoneField', () => {
  it('renders a select with UTC as an option', () => {
    render(<Harness onUseBrowserTimezone={vi.fn()} />);
    expect(screen.getByLabelText('Timezone')).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'UTC' }),
    ).toBeInTheDocument();
  });

  it('calls onUseBrowserTimezone with the resolved browser timezone', () => {
    const onUseBrowserTimezone = vi.fn();
    render(<Harness onUseBrowserTimezone={onUseBrowserTimezone} />);
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`use my timezone`, 'i') }),
    );
    expect(onUseBrowserTimezone).toHaveBeenCalledWith(browserTz);
  });
});
