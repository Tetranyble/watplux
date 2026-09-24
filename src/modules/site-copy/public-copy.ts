import { db } from "@/lib/db";

export async function loadCopyNamespace(namespace: string) {
  const entries = await db.siteCopy.findMany({
    where: { namespace },
    select: { key: true, value: true },
  });
  const values = Object.fromEntries(
    entries.map((entry) => [entry.key, entry.value]),
  );
  return (key: string): string => {
    const value = values[key];
    if (value === undefined)
      throw new Error(`Missing required site copy: ${key}`);
    return value;
  };
}

export function fillCopy(
  value: string,
  variables: Record<string, string | number>,
) {
  return Object.entries(variables).reduce(
    (text, [key, replacement]) =>
      text.replaceAll(`{${key}}`, String(replacement)),
    value,
  );
}
