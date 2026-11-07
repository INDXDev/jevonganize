import { cn } from '../../lib.ts';

/** The one progress bar. Leave `value` out when the total is unknown, and it shows activity. */
export function Progress(props: {
  label: string;
  value?: number;
  max?: number;
  className?: string;
}) {
  const { label, value, max, className } = props;
  return (
    <progress aria-label={label} value={value} max={max} className={cn('progress', className)} />
  );
}
