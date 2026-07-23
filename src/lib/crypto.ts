/**
 * Secure Client-Side Cryptographic Helper
 * Implements real PBKDF2 key derivation & AES-GCM 256-bit encryption/decryption
 * inside the browser using standard Web Crypto APIs.
 */

const SALT = "daisy_omni_secure_salt_2026"; // Consistent salt for derivation
const ITERATIONS = 100000;

// Derive a CryptoKey from a plain-text password
export async function deriveKey(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passwordBytes = enc.encode(password);
  
  // Import raw password as key material
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    passwordBytes,
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  
  const saltBytes = enc.encode(SALT);
  
  // Derive AES-GCM 256-bit key
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false, // Not extractable
    ["encrypt", "decrypt"]
  );
}

// Encrypt plaintext using derived CryptoKey
export async function encryptData(plaintext: string, key: CryptoKey): Promise<string> {
  const enc = new TextEncoder();
  const dataBytes = enc.encode(plaintext);
  
  // Generate a random 12-byte IV for AES-GCM
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const ciphertextBytes = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    dataBytes
  );
  
  // Combine IV and ciphertext for single-string storage
  const combined = new Uint8Array(iv.length + ciphertextBytes.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertextBytes), iv.length);
  
  // Encode combined bytes to Base64
  return btoa(String.fromCharCode(...combined));
}

// Decrypt Base64 string ciphertext using derived CryptoKey
export async function decryptData(base64Ciphertext: string, key: CryptoKey): Promise<string> {
  const binary = atob(base64Ciphertext);
  const combined = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    combined[i] = binary.charCodeAt(i);
  }
  
  // Extract IV (first 12 bytes) and ciphertext
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  
  const decryptedBytes = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    ciphertext
  );
  
  const dec = new TextDecoder();
  return dec.decode(decryptedBytes);
}
