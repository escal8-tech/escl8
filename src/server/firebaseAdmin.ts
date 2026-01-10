import admin from "firebase-admin";
import { createRemoteJWKSet, jwtVerify } from "jose";

let loggedInitError = false;

function maybeLogInitError(msg: string) {
  if (loggedInitError) return;
  loggedInitError = true;
  // Avoid logging secrets. Only log high-level configuration problems.
  console.error(`[firebase-admin] ${msg}`);
}

function tryParseServiceAccount(raw: string): admin.ServiceAccount | null {
  const isValid = (obj: any): obj is admin.ServiceAccount => {
    return !!obj && typeof obj === "object" && typeof obj.client_email === "string" && typeof obj.private_key === "string";
  };

  const maybeUnwrapString = (parsed: any) => {
    // If someone stored JSON as a JSON-encoded string (double encoding), unwrap it.
    if (typeof parsed === "string") {
      try {
        return JSON.parse(parsed);
      } catch {
        return null;
      }
    }
    return parsed;
  };

  // 1) Raw JSON (optionally double-encoded)
  try {
    const parsed1 = JSON.parse(raw);
    const parsed2 = maybeUnwrapString(parsed1);
    if (isValid(parsed2)) return parsed2;
  } catch {}

  // 2) Base64-encoded JSON
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const parsed1 = JSON.parse(decoded);
    const parsed2 = maybeUnwrapString(parsed1);
    if (isValid(parsed2)) return parsed2;
  } catch {}

  return null;
}

function getServiceAccountFromEnv(): admin.ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  return tryParseServiceAccount(raw);
}

export function getFirebaseAdminApp() {
  if (admin.apps.length) return admin.app();

  const serviceAccount = getServiceAccountFromEnv();
  if (!serviceAccount) {
    maybeLogInitError(
      "Missing/invalid FIREBASE_SERVICE_ACCOUNT_JSON. On Vercel, set it as a Project Environment Variable (Production) and redeploy. You can paste raw JSON or base64-encoded JSON.",
    );
    throw new Error(
      "Missing FIREBASE_SERVICE_ACCOUNT_JSON. Set this env var to your Firebase Admin service account JSON.",
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return admin.app();
}

function getFirebaseProjectId(): string | null {
  // Prefer a server-only env var if set.
  const explicit = process.env.FIREBASE_PROJECT_ID;
  if (explicit) return explicit;

  // Fallback to the public Firebase project id (safe; not a secret).
  const fromPublic = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (fromPublic) return fromPublic;

  return null;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function verifyWithPublicKeys(idToken: string) {
  const projectId = getFirebaseProjectId();
  if (!projectId) {
    maybeLogInitError(
      "Missing FIREBASE_PROJECT_ID (or NEXT_PUBLIC_FIREBASE_PROJECT_ID). Needed to verify Firebase ID tokens without a service account.",
    );
    throw new Error("Missing FIREBASE_PROJECT_ID");
  }

  // Firebase ID tokens are signed by Google; verify using the published JWKS.
  // https://firebase.google.com/docs/auth/admin/verify-id-tokens
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
  }

  const issuer = `https://securetoken.google.com/${projectId}`;
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer,
    audience: projectId,
  });

  // Shape this similarly to firebase-admin's DecodedIdToken (only fields we use).
  return {
    uid: (payload.user_id as string | undefined) ?? (payload.sub as string),
    email: payload.email as string | undefined,
    sub: payload.sub as string,
    aud: payload.aud,
    iss: payload.iss,
  } as any;
}

export async function verifyFirebaseIdToken(idToken: string) {
  // Prefer service-account-backed Firebase Admin if configured.
  // Fallback to public-key verification so deployments don't brick if the env var is missing/misformatted.
  try {
    const serviceAccount = getServiceAccountFromEnv();
    if (serviceAccount) {
      const app = getFirebaseAdminApp();
      return await app.auth().verifyIdToken(idToken);
    }
  } catch {
    // fall through
  }

  return await verifyWithPublicKeys(idToken);
}
