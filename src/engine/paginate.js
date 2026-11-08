const AI_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const AI_FINAL_SUFFIX = '\n0.Back 00.Home';

/**
 * Splits text into lossless pages whose control suffixes fit within limit.
 * Delimiters used as preferred split points remain in the page content.
 *
 * @param {string} text
 * @param {number} limit
 * @param {string} nonFinalSuffix
 * @param {string} finalSuffix
 * @returns {string[]}
 */
export function paginateWithControls(
  text,
  limit,
  nonFinalSuffix,
  finalSuffix,
) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (typeof nonFinalSuffix !== 'string') {
    throw new TypeError('nonFinalSuffix must be a string');
  }
  if (typeof finalSuffix !== 'string') {
    throw new TypeError('finalSuffix must be a string');
  }
  if (!Number.isInteger(limit)) {
    throw new TypeError('limit must be an integer');
  }
  if (limit <= 0) {
    throw new RangeError('limit must be greater than zero');
  }
  if (finalSuffix.length > limit) {
    throw new RangeError('limit is too small for the final suffix');
  }

  if (text.length === 0) {
    return [finalSuffix];
  }

  const nonFinalCapacity = limit - nonFinalSuffix.length;
  const finalCapacity = limit - finalSuffix.length;

  if (nonFinalCapacity < 1 || finalCapacity < 1) {
    throw new RangeError(
      'limit must allow at least one content code unit with each suffix',
    );
  }

  const pages = [];
  let remaining = text;

  while (remaining.length > finalCapacity) {
    const allowed = Math.min(nonFinalCapacity, remaining.length - 1);
    const prefix = remaining.slice(0, allowed);
    const lastBreak = Math.max(
      prefix.lastIndexOf(' '),
      prefix.lastIndexOf('\n'),
    );
    const take = lastBreak >= 0 ? lastBreak + 1 : allowed;

    pages.push(remaining.slice(0, take) + nonFinalSuffix);
    remaining = remaining.slice(take);
  }

  pages.push(remaining + finalSuffix);
  return pages;
}

/**
 * Splits AI answer text into lossless USSD pages.
 *
 * @param {string} text
 * @param {number} [limit=160]
 * @returns {string[]}
 */
export function paginate(text, limit = 160) {
  return paginateWithControls(
    text,
    limit,
    AI_NON_FINAL_SUFFIX,
    AI_FINAL_SUFFIX,
  );
}
