import type { AnalyticsDeviceType } from "./types";

const TABLET_PATTERN =
  /ipad|tablet|playbook|silk|(android(?!.*mobile))/i;
const MOBILE_PATTERN =
  /mobile|iphone|ipod|android|blackberry|opera mini|iemobile|webos|fennec|windows phone/i;

export function detectDeviceType(
  userAgent: string | null | undefined,
): AnalyticsDeviceType {
  const ua = userAgent?.trim() ?? "";

  if (!ua) {
    return "unknown";
  }

  if (TABLET_PATTERN.test(ua)) {
    return "tablet";
  }

  if (MOBILE_PATTERN.test(ua)) {
    return "mobile";
  }

  return "desktop";
}
