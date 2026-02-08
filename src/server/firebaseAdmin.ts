import admin from "firebase-admin";

function parseServiceAccount(raw: string): admin.ServiceAccount | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.client_email === "string" && typeof parsed.private_key === "string") {
      return parsed;
    }
  } catch {}

  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.client_email === "string" && typeof parsed.private_key === "string") {
      return parsed;
    }
  } catch {}

  return null;
}

function getServiceAccount(): admin.ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
  }

  const parsed = parseServiceAccount(raw);
  if (!parsed) {
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON");
  }

  return parsed;
}

export function getFirebaseAdminApp() {
  if (admin.apps.length) return admin.app();

  admin.initializeApp({
    credential: admin.credential.cert(getServiceAccount()),
  });

  return admin.app();
}

export async function verifyFirebaseIdToken(idToken: string) {
  const app = getFirebaseAdminApp();
  return await app.auth().verifyIdToken(idToken);
}

type SuiteClaims = {
  suiteTenantId: string;
  suiteUserId: string;
  modules: string[];
};

export async function syncFirebaseSuiteClaims(firebaseUid: string, claims: SuiteClaims) {
  const app = getFirebaseAdminApp();
  const auth = app.auth();
  const user = await auth.getUser(firebaseUid);
  const current = user.customClaims ?? {};
  const currentModules = Array.isArray(current.modules)
    ? current.modules.filter((m): m is string => typeof m === "string")
    : [];
  const mergedModules = Array.from(new Set([...currentModules, ...claims.modules]));

  const next = {
    ...current,
    suiteTenantId: claims.suiteTenantId,
    suiteUserId: claims.suiteUserId,
    modules: mergedModules,
  };

  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (!changed) return;

  await auth.setCustomUserClaims(firebaseUid, {
    ...next,
    suiteV: Math.floor(Date.now() / 1000),
  });
}
