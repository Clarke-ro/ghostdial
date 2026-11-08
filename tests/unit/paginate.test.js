import { describe, expect, it } from 'vitest';
import {
  paginate,
  paginateWithControls,
} from '../../src/engine/paginate.js';

const AI_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const AI_FINAL_SUFFIX = '\n0.Back 00.Home';
const TIP_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const TIP_FINAL_SUFFIX = '\n0.Back';

function pageContent(page, suffix) {
  expect(page.endsWith(suffix)).toBe(true);
  return page.slice(0, -suffix.length);
}

function reconstruct(pages, nonFinalSuffix, finalSuffix) {
  return pages
    .map((page, index) =>
      pageContent(
        page,
        index === pages.length - 1 ? finalSuffix : nonFinalSuffix,
      ),
    )
    .join('');
}

describe('paginate', () => {
  it('uses the default 160-character limit and exact AI suffixes', () => {
    const text = 'x'.repeat(300);
    const pages = paginate(text);

    expect(pages).toHaveLength(3);
    expect(pages[0]).toHaveLength(160);
    expect(pages[0].endsWith(AI_NON_FINAL_SUFFIX)).toBe(true);
    expect(pages[1].endsWith(AI_NON_FINAL_SUFFIX)).toBe(true);
    expect(pages[2].endsWith(AI_FINAL_SUFFIX)).toBe(true);
    expect(pages.every((page) => page.length <= 160)).toBe(true);
    expect(reconstruct(pages, AI_NON_FINAL_SUFFIX, AI_FINAL_SUFFIX)).toBe(
      text,
    );
  });

  it('honors a custom limit for one-page and multi-page answers', () => {
    expect(paginate('ghost', 20)).toEqual([
      `ghost${AI_FINAL_SUFFIX}`,
    ]);

    const pages = paginate('abcdefghijkl', 20);

    expect(pages).toEqual([
      `abcdef${AI_NON_FINAL_SUFFIX}`,
      `ghijk${AI_NON_FINAL_SUFFIX}`,
      `l${AI_FINAL_SUFFIX}`,
    ]);
    expect(pages.every((page) => page.length <= 20)).toBe(true);
  });

  it('returns the final suffix as the single non-empty page for empty text', () => {
    expect(paginate('', AI_FINAL_SUFFIX.length)).toEqual([
      AI_FINAL_SUFFIX,
    ]);
  });

  it('supports the minimum capable AI suffix boundary', () => {
    const limit = AI_FINAL_SUFFIX.length + 1;

    expect(paginate('a', limit)).toEqual([`a${AI_FINAL_SUFFIX}`]);
    expect(paginate('ab', limit)).toEqual([
      `a${AI_NON_FINAL_SUFFIX}`,
      `b${AI_FINAL_SUFFIX}`,
    ]);
  });

  it('retains a preferred space at the end of the current page', () => {
    const pages = paginate('abc de', 20);

    expect(pages).toEqual([
      `abc ${AI_NON_FINAL_SUFFIX}`,
      `de${AI_FINAL_SUFFIX}`,
    ]);
    expect(pageContent(pages[0], AI_NON_FINAL_SUFFIX).endsWith(' ')).toBe(
      true,
    );
  });

  it('retains a preferred newline at the end of the current page', () => {
    const pages = paginate('abc\nde', 20);

    expect(pages).toEqual([
      `abc\n${AI_NON_FINAL_SUFFIX}`,
      `de${AI_FINAL_SUFFIX}`,
    ]);
    expect(pageContent(pages[0], AI_NON_FINAL_SUFFIX).endsWith('\n')).toBe(
      true,
    );
  });

  it('uses the last available space or newline in the allowed prefix', () => {
    const pages = paginate('a b\ncdef', 20);

    expect(pageContent(pages[0], AI_NON_FINAL_SUFFIX)).toBe('a b\n');
    expect(reconstruct(pages, AI_NON_FINAL_SUFFIX, AI_FINAL_SUFFIX)).toBe(
      'a b\ncdef',
    );
  });

  it('hard-cuts an unbroken run only when its allowed prefix has no delimiter', () => {
    const unbrokenPages = paginate('abcdef', 20);
    const breakablePages = paginate('abcd ef', 20);

    expect(pageContent(unbrokenPages[0], AI_NON_FINAL_SUFFIX)).toBe(
      'abcde',
    );
    expect(pageContent(breakablePages[0], AI_NON_FINAL_SUFFIX)).toBe(
      'abcd ',
    );
    expect(reconstruct(unbrokenPages, AI_NON_FINAL_SUFFIX, AI_FINAL_SUFFIX)).toBe(
      'abcdef',
    );
    expect(reconstruct(breakablePages, AI_NON_FINAL_SUFFIX, AI_FINAL_SUFFIX)).toBe(
      'abcd ef',
    );
  });

  it.each([
    ['non-string text', () => paginate(null), TypeError],
    ['non-integer limit', () => paginate('text', 20.5), TypeError],
    ['zero limit', () => paginate('text', 0), RangeError],
    ['negative limit', () => paginate('text', -1), RangeError],
    [
      'limit shorter than the final suffix',
      () => paginate('', AI_FINAL_SUFFIX.length - 1),
      RangeError,
    ],
    [
      'non-empty text without final content capacity',
      () => paginate('a', AI_FINAL_SUFFIX.length),
      RangeError,
    ],
    [
      'non-string non-final suffix',
      () => paginateWithControls('text', 20, null, TIP_FINAL_SUFFIX),
      TypeError,
    ],
    [
      'non-string final suffix',
      () => paginateWithControls('text', 20, TIP_NON_FINAL_SUFFIX, null),
      TypeError,
    ],
    [
      'non-empty text without non-final content capacity',
      () => paginateWithControls(
        'long enough',
        TIP_NON_FINAL_SUFFIX.length,
        TIP_NON_FINAL_SUFFIX,
        TIP_FINAL_SUFFIX,
      ),
      RangeError,
    ],
  ])('rejects invalid arguments: %s', (_label, invoke, ErrorType) => {
    expect(invoke).toThrow(ErrorType);
  });
});

describe('paginateWithControls for local tips', () => {
  it('uses the local final suffix for empty and one-page content', () => {
    expect(
      paginateWithControls(
        '',
        TIP_FINAL_SUFFIX.length,
        TIP_NON_FINAL_SUFFIX,
        TIP_FINAL_SUFFIX,
      ),
    ).toEqual([TIP_FINAL_SUFFIX]);

    expect(
      paginateWithControls(
        'Breathe.',
        20,
        TIP_NON_FINAL_SUFFIX,
        TIP_FINAL_SUFFIX,
      ),
    ).toEqual([`Breathe.${TIP_FINAL_SUFFIX}`]);
  });

  it('preserves local-tip content exactly with correct suffixes and limits', () => {
    const text = 'Plan one topic.\nRest, then review. ' + 'x'.repeat(30);
    const limit = 24;
    const pages = paginateWithControls(
      text,
      limit,
      TIP_NON_FINAL_SUFFIX,
      TIP_FINAL_SUFFIX,
    );

    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages.slice(0, -1)) {
      expect(page.endsWith(TIP_NON_FINAL_SUFFIX)).toBe(true);
      expect(page.length).toBeLessThanOrEqual(limit);
    }
    expect(pages.at(-1).endsWith(TIP_FINAL_SUFFIX)).toBe(true);
    expect(pages.at(-1).length).toBeLessThanOrEqual(limit);
    expect(
      reconstruct(pages, TIP_NON_FINAL_SUFFIX, TIP_FINAL_SUFFIX),
    ).toBe(text);
  });

  it('fills complete local-tip pages to the supplied limit for unbroken text', () => {
    const limit = 20;
    const text = 'x'.repeat(31);
    const pages = paginateWithControls(
      text,
      limit,
      TIP_NON_FINAL_SUFFIX,
      TIP_FINAL_SUFFIX,
    );

    expect(pages.slice(0, -1).every((page) => page.length === limit)).toBe(
      true,
    );
    expect(pages.at(-1).length).toBeLessThanOrEqual(limit);
    expect(
      reconstruct(pages, TIP_NON_FINAL_SUFFIX, TIP_FINAL_SUFFIX),
    ).toBe(text);
  });

  it('accounts independently for unequal local-tip suffix capacities', () => {
    const limit = TIP_NON_FINAL_SUFFIX.length + 1;
    const pages = paginateWithControls(
      'abcdefghi',
      limit,
      TIP_NON_FINAL_SUFFIX,
      TIP_FINAL_SUFFIX,
    );

    expect(pages).toEqual([
      `a${TIP_NON_FINAL_SUFFIX}`,
      `bcdefghi${TIP_FINAL_SUFFIX}`,
    ]);
    expect(pages.every((page) => page.length <= limit)).toBe(true);
    expect(
      reconstruct(pages, TIP_NON_FINAL_SUFFIX, TIP_FINAL_SUFFIX),
    ).toBe('abcdefghi');
  });
});
