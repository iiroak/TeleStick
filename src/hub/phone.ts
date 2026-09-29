/**
 * Normalizes a phone number to a WhatsApp `@c.us` chat id.
 *
 * The gateway does not normalize this format; an incorrect format may fail
 * downstream. This function produces a normalized WhatsApp chat id.
 *
 * International numbers must use a +country-code prefix unless a default
 * country code is explicitly configured. Full WhatsApp JIDs pass through.
 */
export function normalizeChatId(raw: string, defaultCountryCode = ""): string {
  const trimmed = raw.trim();
  if (trimmed.includes("@")) {
    return trimmed;
  }
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length === 0) {
    throw new Error(`Cannot normalize phone number: "${raw}"`);
  }
  if (trimmed.startsWith("+")) {
    return `${digits}@c.us`;
  }
  if (defaultCountryCode && digits.startsWith(defaultCountryCode)) {
    return `${digits}@c.us`;
  }
  if (!defaultCountryCode) {
    throw new Error("Use an international number starting with + or configure DEFAULT_COUNTRY_CODE");
  }
  return `${defaultCountryCode}${digits}@c.us`;
}

export function isValidChatId(value: string): boolean {
  return /^[0-9]+@(c\.us|g\.us)$/.test(value);
}
