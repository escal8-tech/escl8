import admin from "firebase-admin";

let loggedInitError = false;

function maybeLogInitError(msg: string) {
  if (loggedInitError) return;
  loggedInitError = true;
  // Avoid logging secrets. Only log high-level configuration problems.
  console.error(`[firebase-admin] ${msg}`);
}

function tryParseServiceAccount(raw: string): admin.ServiceAccount | null {
  // 1) Raw JSON
  try {
    const parsed = JSON.parse(raw);
    return parsed as admin.ServiceAccount;
  } catch {}

  // 2) Base64-encoded JSON
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    return parsed as admin.ServiceAccount;
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

export async function verifyFirebaseIdToken(idToken: string) {
  const app = getFirebaseAdminApp();
  return await app.auth().verifyIdToken(idToken);
}
