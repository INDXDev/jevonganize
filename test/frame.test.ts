import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Frame } from '../src/web/components/preview/frame.tsx';

it('sandboxes untrusted HTML, with its policy ahead of the file', () => {
  const hostile = '<meta http-equiv="Content-Security-Policy" content="default-src *"><script>';
  const markup = renderToStaticMarkup(createElement(Frame, { html: hostile, title: 'x' }));
  expect(markup).toContain('<iframe sandbox=""');
  expect(markup).not.toContain('allow-');
  expect(markup.indexOf('default-src &#x27;none&#x27;')).toBeGreaterThan(-1);
  expect(markup.indexOf('default-src &#x27;none&#x27;')).toBeLessThan(
    markup.indexOf('default-src *'),
  );
});
