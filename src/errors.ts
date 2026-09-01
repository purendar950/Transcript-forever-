export type ErrorCode =
  | "invalid_request"
  | "invalid_video_id"
  | "invalid_format"
  | "video_unavailable"
  | "captions_disabled"
  | "language_unavailable"
  | "empty_transcript"
  | "upstream_error"
  | "rate_limited"
  | "not_found";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  invalid_request: 400,
  invalid_video_id: 400,
  invalid_format: 400,
  video_unavailable: 404,
  captions_disabled: 404,
  language_unavailable: 404,
  empty_transcript: 404,
  upstream_error: 502,
  rate_limited: 429,
  not_found: 404,
};

export class TranscriptError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "TranscriptError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}
