import { graphEndpoint, graphJson, MetaGraphError } from "@/server/meta/graph";

export type MetaPhoneNumberLookup = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  status?: string;
  code_verification_status?: string;
  last_onboarded_time?: string;
};

export type MetaPhoneNumberEdge = {
  data?: Array<{
    id?: string;
    display_phone_number?: string;
    verified_name?: string;
  }>;
  paging?: {
    next?: string | null;
  };
};

export type MetaWabaList = {
  data?: Array<{
    id?: string;
    name?: string;
    phone_numbers?: MetaPhoneNumberEdge;
  }>;
  paging?: {
    next?: string | null;
  };
};

export function normalizeGraphId(value: string | null | undefined): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export function hasPhoneNumber(edge: MetaPhoneNumberEdge | null | undefined, phoneNumberId: string) {
  return Boolean(edge?.data?.some((item) => item.id?.trim() === phoneNumberId));
}

export function nextPagingUrl(
  paging: { next?: string | null } | null | undefined,
): string | null {
  return typeof paging?.next === "string" && paging.next.trim() ? paging.next.trim() : null;
}

export async function wabaOwnsPhoneNumber(args: {
  wabaId: string | null | undefined;
  phoneNumberId: string;
  metaGraphApiVersion: string;
  accessTokens: Array<string | undefined>;
}) {
  const normalizedWabaId = normalizeGraphId(args.wabaId);
  if (!normalizedWabaId) return false;

  for (const accessToken of args.accessTokens) {
    if (!accessToken) continue;
    let endpoint: string | null = graphEndpoint(args.metaGraphApiVersion, `/${normalizedWabaId}/phone_numbers`);

    while (endpoint) {
      try {
        const page = await graphJson<MetaPhoneNumberEdge>({
          endpoint,
          method: "GET",
          accessToken,
          query: endpoint.includes("?")
            ? undefined
            : {
                fields: "id,display_phone_number,verified_name",
                limit: 200,
              },
        });

        if (hasPhoneNumber(page, args.phoneNumberId)) return true;
        endpoint = nextPagingUrl(page.paging);
      } catch (error) {
        if (error instanceof MetaGraphError) {
          endpoint = null;
          break;
        }
        throw error;
      }
    }
  }

  return false;
}

export async function discoverWabaIdForPhoneNumber(args: {
  phoneNumberId: string;
  metaGraphApiVersion: string;
  accessTokens: Array<string | undefined>;
}) {
  const edges = [
    "client_whatsapp_business_accounts",
    "owned_whatsapp_business_accounts",
    "assigned_whatsapp_business_accounts",
  ] as const;

  for (const accessToken of args.accessTokens) {
    if (!accessToken) continue;

    for (const edge of edges) {
      let endpoint: string | null = graphEndpoint(args.metaGraphApiVersion, `/me/${edge}`);

      while (endpoint) {
        try {
          const page = await graphJson<MetaWabaList>({
            endpoint,
            method: "GET",
            accessToken,
            query: endpoint.includes("?")
              ? undefined
              : {
                  fields: "id,name,phone_numbers{id,display_phone_number,verified_name}",
                  limit: 200,
                },
          });

          const match = page.data?.find((waba) => hasPhoneNumber(waba.phone_numbers, args.phoneNumberId));
          const normalizedMatchId = normalizeGraphId(match?.id);
          if (normalizedMatchId) return normalizedMatchId;

          endpoint = nextPagingUrl(page.paging);
        } catch (error) {
          if (error instanceof MetaGraphError) {
            endpoint = null;
            break;
          }
          throw error;
        }
      }
    }
  }

  return null;
}

export async function resolveAuthoritativeWabaId(args: {
  requestedWabaId?: string;
  requestedWabaIds?: string[];
  phoneNumberId: string;
  metaGraphApiVersion: string;
  systemUserToken: string;
  businessToken: string;
}) {
  const accessTokens = [args.systemUserToken, args.businessToken];
  const requestedWabaIds = Array.from(
    new Set(
      [args.requestedWabaId, ...(args.requestedWabaIds || [])]
        .map((value) => normalizeGraphId(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  for (const requestedWabaId of requestedWabaIds) {
    if (
      await wabaOwnsPhoneNumber({
        wabaId: requestedWabaId,
        phoneNumberId: args.phoneNumberId,
        metaGraphApiVersion: args.metaGraphApiVersion,
        accessTokens,
      })
    ) {
      return requestedWabaId;
    }
  }

  return discoverWabaIdForPhoneNumber({
    phoneNumberId: args.phoneNumberId,
    metaGraphApiVersion: args.metaGraphApiVersion,
    accessTokens: [args.businessToken, args.systemUserToken],
  });
}

export function normalizeRequestedWabaIds(values: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => normalizeGraphId(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}
