import { getLanguage, t } from '../i18n/index.ts';
import type { Estimate } from '../../types.ts';
import { useTool } from '../api.ts';
import { formatCost, formatCount } from '../lib.ts';

type Limits = { budget?: { text_chars?: number; images?: number }; send_images?: boolean };

/** What a run sends and what it costs. Shown before every organize, with no way past it. */
export function SendNotice({ estimate, provider }: { estimate?: Estimate; provider: string }) {
  const { data } = useTool('get_config', {});
  const { budget, send_images: images = true } = (data?.config ?? {}) as Limits;

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {images
          ? t(
              'Sent to {provider} for each file: its name, up to {characters} characters of text, up to {images} images, and metadata. Nothing else.',
              {
                provider,
                characters: formatCount(budget?.text_chars ?? 0),
                images: budget?.images ?? 0,
              },
            )
          : t(
              'Sent to {provider} for each file: its name, up to {characters} characters of text and metadata. Nothing else.',
              { provider, characters: formatCount(budget?.text_chars ?? 0) },
            )}
      </p>
      {estimate && (
        <p className="font-mono text-xs">
          {t('{files} files · {cached} cached · {facets} facets · {tokens}M tokens', {
            files: formatCount(estimate.files),
            cached: formatCount(estimate.cached),
            facets: estimate.facets,
            tokens: (estimate.tokens / 1e6).toLocaleString(getLanguage(), {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }),
          })}{' '}
          · {formatCost(estimate.cost_usd)}
        </p>
      )}
    </>
  );
}
