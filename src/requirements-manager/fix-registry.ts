import { FIX_HANDLERS, type FixContext, type FixResult } from './fix-handlers';

/**
 * Find the first handler that can handle the given context, then run it.
 * Returns `{ ok: false }` if no handler matches or the chosen handler reports
 * failure. Callers wrap this in their own retry/state-update logic.
 */
export async function dispatchFix(ctx: FixContext): Promise<FixResult> {
  const handler = FIX_HANDLERS.find((h) => h.canHandle(ctx));
  if (!handler) {
    return {
      ok: false,
      error: `No fix handler matched (fixType=${JSON.stringify(ctx.fixType ?? null)})`,
    };
  }
  return handler.execute(ctx);
}
