/**
 * Phase 5-8.2 — pure logic for MediaValidationBanner.
 *
 * Extracted so the node smoke test (scripts/test-media-probe.ts) can
 * import it without dragging in React / Electron. The contract:
 *
 *   The convert button is offered when ANY of:
 *     1. Probe classifier said "unsupported" (e.g. HEVC, 10-bit).
 *     2. Parent forced visibility (Chromium runtime decode failure)
 *        — this trumps probe verdict because the inner <video>
 *        element rejecting a file is the ultimate authority.
 *
 * The Phase 5-8.1 regression that motivated this split: 1920×3414
 * h264/yuv420p source, probe says "supported", banner suppressed the
 * convert UI, user stuck.
 */
export function shouldShowConvert(opts: {
  /** Probe verdict. null while probe is in flight or hasn't started. */
  probeSupported: boolean | null;
  /** True when LivePreview's <video> element errored or its 5s
   *  canplay watchdog tripped. Authoritative even when probeSupported
   *  is true — that's the bug we're fixing. */
  forceShow: boolean;
}): boolean {
  if (opts.forceShow) return true;
  if (opts.probeSupported === false) return true;
  return false;
}
