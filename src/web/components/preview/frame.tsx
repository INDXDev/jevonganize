import { cn } from '../../lib.ts';

/**
 * Stricter than the page's CSP, which applies too. It goes first, and a policy in the file can only
 * add to it. Nothing the file links to loads, so opening it tells no server that it was read.
 */
const FRAME_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

/** The only place untrusted HTML renders. `sandbox=""`: no script, no forms, no origin of its own. */
export function Frame(props: { html: string; title: string; className?: string }) {
  const { html, title, className } = props;
  // `_blank` is refused by the sandbox, so a link does nothing, rather than blanking the frame.
  const head = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><base target="_blank">`;
  return (
    <iframe sandbox="" title={title} srcDoc={head + html} className={cn('size-full', className)} />
  );
}
