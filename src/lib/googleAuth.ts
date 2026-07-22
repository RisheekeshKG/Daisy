import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send'
];

let cachedAccessToken: string | null = null;
let isSigningIn = false;
let authInstance: any = null;

// Initialize Firebase dynamically to avoid build crashes when firebase-applet-config.json doesn't exist yet
export async function getGoogleAuth() {
  if (authInstance) return authInstance;
  try {
    const res = await fetch('/firebase-applet-config.json');
    if (!res.ok) {
      throw new Error("Config not available on server yet");
    }
    const config = await res.json();
    const app = initializeApp(config);
    authInstance = getAuth(app);
    return authInstance;
  } catch (error) {
    console.warn("Google Auth Config is not available yet. Please complete OAuth configuration.");
    return null;
  }
}

export const initAuth = async (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  const auth = await getGoogleAuth();
  if (!auth) {
    if (onAuthFailure) onAuthFailure();
    return () => {};
  }

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  const auth = await getGoogleAuth();
  if (!auth) {
    throw new Error('Google Workspace config is missing. Please configure it via the OAuth setup card first.');
  }

  try {
    isSigningIn = true;
    const provider = new GoogleAuthProvider();
    SCOPES.forEach(scope => provider.addScope(scope));

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google Sign-In.');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  const auth = await getGoogleAuth();
  if (auth) {
    await auth.signOut();
  }
  cachedAccessToken = null;
};
