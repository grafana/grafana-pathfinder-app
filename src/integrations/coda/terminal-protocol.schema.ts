/**
 * Grafana Live terminal protocol — the consumer half of the contract.
 *
 * The producer is the plugin backend's RunStream, which marshals a
 * TerminalStreamOutput to JSON and ships it inside a DataFrame field via
 * `sender.SendFrame`. Frames that do not validate are reported to the caller
 * with a reason instead of being dropped, so a protocol mismatch presents as a
 * diagnosable message rather than a 35-second handshake timeout.
 */

import { z } from 'zod';

const OutputFrameSchema = z.object({
  type: z.literal('output'),
  data: z.string(),
});

const ErrorFrameSchema = z.object({
  type: z.literal('error'),
  error: z.string(),
});

const ConnectedFrameSchema = z.object({
  type: z.literal('connected'),
  vmId: z.string().optional(),
});

const DisconnectedFrameSchema = z.object({
  type: z.literal('disconnected'),
});

const StatusFrameSchema = z.object({
  type: z.literal('status'),
  // `state` is deliberately open, not an enum: the backend forwards Coda's raw
  // VM state verbatim and formats unrecognized tokens rather than rejecting
  // them, so the token set is not ours to enumerate. Narrow known tokens at the
  // point of display only, always with a passthrough default.
  state: z.string().optional(),
  message: z.string().optional(),
  vmId: z.string().optional(),
});

const HeartbeatFrameSchema = z.object({
  type: z.literal('heartbeat'),
});

export const TerminalStreamOutputSchema = z.discriminatedUnion('type', [
  OutputFrameSchema,
  ErrorFrameSchema,
  ConnectedFrameSchema,
  DisconnectedFrameSchema,
  StatusFrameSchema,
  HeartbeatFrameSchema,
]);

/** A validated inbound frame. */
export type TerminalStreamOutput = z.infer<typeof TerminalStreamOutputSchema>;

/** Outbound messages, mirroring the backend's TerminalInput. */
export type TerminalInputMessage = { type: 'input'; data: string } | { type: 'resize'; rows: number; cols: number };

/**
 * Outcome of reading one Grafana Live message.
 *
 * `unrecognized` means the message never claimed to be a terminal frame (for
 * example a schema-only DataFrame); `invalid` means something that did claim to
 * be one failed validation, which is what the caller surfaces to the user.
 */
export type TerminalFrameParse =
  { status: 'ok'; frame: TerminalStreamOutput } | { status: 'invalid'; detail: string } | { status: 'unrecognized' };

const KNOWN_FRAME_TYPES: ReadonlySet<string> = new Set(
  TerminalStreamOutputSchema.options.map((option) => option.shape.type.value)
);

function readClaimedType(candidate: unknown): string | undefined {
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }
  const type = (candidate as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

function describeFailure(candidate: unknown, error: z.ZodError): string {
  const claimedType = readClaimedType(candidate);
  if (claimedType !== undefined && !KNOWN_FRAME_TYPES.has(claimedType)) {
    return `unknown message type "${claimedType}"`;
  }

  const issue = error.issues[0];
  if (!issue) {
    return 'failed validation';
  }
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

function validateFrame(candidate: unknown): TerminalFrameParse {
  const result = TerminalStreamOutputSchema.safeParse(candidate);
  return result.success
    ? { status: 'ok', frame: result.data }
    : { status: 'invalid', detail: describeFailure(candidate, result.error) };
}

function parseJsonFrame(raw: string): TerminalFrameParse {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { status: 'invalid', detail: 'payload is not valid JSON' };
  }
  return validateFrame(decoded);
}

/**
 * Read a terminal frame out of a Grafana Live message.
 *
 * Production framing is the DataFrame path — every backend emitter uses
 * `SendFrame` — but the direct-object and raw-string shapes are still accepted
 * because Grafana Live does not guarantee which one a message arrives as.
 */
export function parseTerminalFrame(message: unknown): TerminalFrameParse {
  if (typeof message === 'string') {
    return parseJsonFrame(message);
  }

  if (message && typeof message === 'object') {
    const record = message as Record<string, unknown>;
    if (typeof record.type === 'string') {
      return validateFrame(record);
    }

    const fieldValues = (record as { data?: { values?: unknown[][] } }).data?.values?.[0];
    if (Array.isArray(fieldValues) && fieldValues.length > 0) {
      const payload = fieldValues[0];
      if (typeof payload !== 'string') {
        return { status: 'invalid', detail: 'data.values.0.0: expected string' };
      }
      if (payload.length === 0) {
        return { status: 'invalid', detail: 'data.values.0.0: expected non-empty JSON string' };
      }
      return parseJsonFrame(payload);
    }
  }

  return { status: 'unrecognized' };
}
