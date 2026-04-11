export const BUSINESS_MESSAGE_USAGE_TIERS = [
  { value: "minimum", label: "Minimum", monthlyLimit: 30_000 },
  { value: "standard", label: "Standard", monthlyLimit: 50_000 },
  { value: "enterprise", label: "Enterprise", monthlyLimit: 100_000 },
] as const;

export type BusinessMessageUsageTier = (typeof BUSINESS_MESSAGE_USAGE_TIERS)[number]["value"];

export function normalizeBusinessMessageUsageTier(
  value: string | null | undefined,
): BusinessMessageUsageTier {
  if (value === "minimum" || value === "enterprise") return value;
  return "standard";
}

export function getBusinessMessageUsageLimit(
  tier: string | null | undefined,
): number {
  const normalizedTier = normalizeBusinessMessageUsageTier(tier);
  return BUSINESS_MESSAGE_USAGE_TIERS.find((option) => option.value === normalizedTier)?.monthlyLimit ?? 50_000;
}

export function getBusinessMessageUsageTierLabel(
  tier: string | null | undefined,
): string {
  const normalizedTier = normalizeBusinessMessageUsageTier(tier);
  return BUSINESS_MESSAGE_USAGE_TIERS.find((option) => option.value === normalizedTier)?.label ?? "Standard";
}
