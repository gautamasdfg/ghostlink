// GhostLink E2EE — WebCrypto ECDH + AES-GCM
// New ephemeral keypair every session

export async function generateEphemeralKeyPair() {
  const keyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
  );
  const raw = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeyB64 = btoa(String.fromCharCode(...new Uint8Array(raw)));
  return { keyPair, publicKeyB64 };
}

export async function importPublicKey(b64) {
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return window.crypto.subtle.importKey('spki', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

export async function deriveSharedKey(privateKey, remotePublicKey) {
  return window.crypto.subtle.deriveKey(
    { name: 'ECDH', public: remotePublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(sharedKey, plaintext) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(plaintext));
  const ct = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, encoded);
  return {
    encrypted: true,
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ct)))
  };
}

export async function decryptMessage(sharedKey, payload) {
  const iv = Uint8Array.from(atob(payload.iv), c => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(payload.ciphertext), c => c.charCodeAt(0));
  const plain = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

// Room key derived from invite code — same key for all members
export async function deriveRoomKey(inviteCode) {
  const mat = await window.crypto.subtle.importKey(
    'raw', new TextEncoder().encode(inviteCode), 'PBKDF2', false, ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('ghostlink-room-v1'), iterations: 100000, hash: 'SHA-256' },
    mat, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export async function encryptRoomMessage(roomKey, plaintext) {
  return encryptMessage(roomKey, plaintext);
}

export async function decryptRoomMessage(roomKey, payload) {
  return decryptMessage(roomKey, payload);
}
