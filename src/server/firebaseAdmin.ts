import admin from "firebase-admin";

function getServiceAccountFromEnv(): admin.ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed as admin.ServiceAccount;
  } catch {
    return null;
  }
}

export function getFirebaseAdminApp() {
  if (admin.apps.length) return admin.app();

  const serviceAccount = getServiceAccountFromEnv();
  if (!serviceAccount) {
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
