// auth.js: password login. The password unlocks the GitHub token.
//
// "Set a password" (only possible while logged in with the token) encrypts the
// token with a key made from the password, and commits the result as
// admin/auth.json. The file is public (the whole site is), so it is only as
// safe as the password: use a long one, like 4 random words.
//   key  = PBKDF2-SHA256(password, random 16-byte salt, 600,000 rounds) -> AES-256
//   data = AES-GCM(key, random 12-byte IV, token)
// A wrong password makes AES-GCM's check fail, so we know it's wrong.
// The password and the token are never saved in the file or printed.
// Browser built-in crypto only (WebCrypto, crypto.subtle).

const auth = (function () {
  const ITERATIONS = 600000;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

  async function keyFrom(password, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // -> the auth.json object (everything base64)
  async function lock(password, token) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFrom(password, salt, ITERATIONS);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token));
    return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, cipher: 'AES-256-GCM',
      salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(ciphertext), savedAt: new Date().toISOString() };
  }

  // -> the token, or throws Error('Wrong password')
  async function unlock(password, file) {
    const key = await keyFrom(password, fromB64(file.salt), file.iterations);
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, key, fromB64(file.ciphertext));
      return dec.decode(plain);
    } catch (e) {
      throw new Error('Wrong password');
    }
  }

  return { lock, unlock, MIN_LENGTH: 12 };
})();
