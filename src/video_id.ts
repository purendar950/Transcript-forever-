const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const URL_PATTERNS = [
  /(?:youtube\.com|youtube-nocookie\.com)\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{11})/,
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
  /(?:youtube\.com|youtube-nocookie\.com)\/(?:shorts|embed|live|v|e)\/([A-Za-z0-9_-]{11})/,
  /(?:youtube\.com)\/clip\/.*[?&]v=([A-Za-z0-9_-]{11})/,
];

/**
 * Accepts a raw video id, a full YouTube URL (watch / youtu.be / shorts /
 * embed / live), or a URL without a scheme, and returns the 11 character id.
 */
export function extractVideoId(input: string | null | undefined): string | null {
  if (!input) return null;

  const value = input.trim();
  if (!value) return null;
  if (ID_PATTERN.test(value)) return value;

  for (const pattern of URL_PATTERNS) {
    const match = value.match(pattern);
    if (match) return match[1];
  }

  return null;
}
