export type SiteCopyDictionary = Record<string, string>;

/** Required lookup by design: missing seed/content is an editorial error and
 * must never silently resurrect hard-coded visitor copy. */
export function copyValue(copy: SiteCopyDictionary, key: string): string {
  const value = copy[key];
  if (value === undefined)
    throw new Error(`Missing required site copy: ${key}`);
  return value;
}

export function interpolateCopy(
  value: string,
  variables: Record<string, string | number>,
): string {
  return Object.entries(variables).reduce(
    (result, [key, replacement]) =>
      result.replaceAll(`{${key}}`, String(replacement)),
    value,
  );
}
