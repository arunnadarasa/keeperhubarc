const INSTRUCTION_PATTERNS = [
  /\byou must\b/gi,
  /\balways\b/gi,
  /\bnever\b/gi,
  /\byou should\b/gi,
  /\bmake sure to\b/gi,
  /\bensure that\b/gi,
  /\bremember to\b/gi,
  /\bdo not forget to\b/gi,
] as const;

export function sanitizeDescription(raw: string): string {
  if (!raw) {
    return "";
  }

  let result = raw;

  // Strip markdown: headers (#, ##, etc.)
  result = result.replace(/^#{1,6}\s*/gm, "");

  // Strip bold (**text** and __text__)
  result = result.replace(/\*\*(.*?)\*\*/g, "$1");
  result = result.replace(/__(.*?)__/g, "$1");

  // Strip italic (*text* and _text_) — single markers only
  result = result.replace(/\*([^*]+)\*/g, "$1");
  result = result.replace(/_([^_]+)_/g, "$1");

  // Strip inline code backticks
  result = result.replace(/`([^`]*)`/g, "$1");

  // Strip link syntax [text](url) -> text
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Strip bullet chars at line start (- or *)
  result = result.replace(/^[-*]\s*/gm, "");

  // Remove instruction-like phrases
  for (const pattern of INSTRUCTION_PATTERNS) {
    result = result.replace(pattern, "");
  }

  // Collapse multiple whitespace and newlines into single spaces
  result = result.replace(/\s+/g, " ");

  // Trim leading/trailing whitespace
  result = result.trim();

  // If the original string started with an uppercase letter but the transformed
  // result starts with lowercase (due to instruction phrase removal), re-capitalize.
  if (
    result.length > 0 &&
    raw.length > 0 &&
    raw[0] === raw[0].toUpperCase() &&
    raw[0] !== raw[0].toLowerCase() &&
    result[0] === result[0].toLowerCase()
  ) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }

  // Cap at 200 characters
  if (result.length > 200) {
    result = result.slice(0, 200);
  }

  return result;
}
