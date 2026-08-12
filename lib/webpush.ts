/**
 * Web Push using only WebCrypto and fetch — no Node built-ins, so it runs
 * unchanged on Node and on Cloudflare Workers.
 *
 * Two independent pieces, per the specs:
 *   RFC 8291 — payload encryption (aes128gcm). The push service cannot read this,
 *              which is why a malformed payload still returns 201 Created.
 *   RFC 8292 — VAPID, an ES256 JWT proving who the sender is.
 *
 * The encryption path is verified byte-for-byte against the RFC 8291 §5 example
 * in the unit tests. That is the only feedback loop this subsystem has.
 */

const enc = new TextEncoder();

export function b64urlDecode(s: string): Uint8Array {
  const padded = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** WebCrypto's HKDF is Extract+Expand in one call, which is exactly what RFC 8291 needs. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/** A raw P-256 keypair (65-byte uncompressed public, 32-byte private scalar) as WebCrypto keys. */
async function importPrivate(
  publicRaw: Uint8Array,
  privateRaw: Uint8Array,
  algorithm: "ECDH" | "ECDSA",
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: b64urlEncode(privateRaw),
      x: b64urlEncode(publicRaw.slice(1, 33)),
      y: b64urlEncode(publicRaw.slice(33, 65)),
      ext: true,
    },
    { name: algorithm, namedCurve: "P-256" },
    false,
    usages,
  );
}

export type EncryptParams = {
  plaintext: Uint8Array;
  /** The subscription's `p256dh`, raw uncompressed. */
  uaPublic: Uint8Array;
  /** The subscription's `auth`, 16 bytes. */
  authSecret: Uint8Array;
  /** Injected only by tests; otherwise random. */
  salt?: Uint8Array;
  asKeys?: { publicKey: Uint8Array; privateKey: Uint8Array };
  recordSize?: number;
};

/** Returns the complete aes128gcm body: salt ‖ rs ‖ idlen ‖ as_public ‖ ciphertext. */
export async function encryptPayload(p: EncryptParams): Promise<Uint8Array> {
  const salt = p.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const recordSize = p.recordSize ?? 4096;

  let asPublic: Uint8Array;
  let asPrivateKey: CryptoKey;

  if (p.asKeys) {
    asPublic = p.asKeys.publicKey;
    asPrivateKey = await importPrivate(p.asKeys.publicKey, p.asKeys.privateKey, "ECDH", ["deriveBits"]);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    asPrivateKey = pair.privateKey;
  }

  const uaKey = await crypto.subtle.importKey(
    "raw",
    p.uaPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivateKey, 256),
  );

  // The key_info binds the derived secret to both parties' public keys.
  const keyInfo = concat(enc.encode("WebPush: info"), new Uint8Array([0]), p.uaPublic, asPublic);
  const ikm = await hkdf(p.authSecret, shared, keyInfo, 32);

  const cek = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  // 0x02 is the last-record delimiter; we always send exactly one record.
  const padded = concat(p.plaintext, new Uint8Array([2]));

  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource, tagLength: 128 }, aesKey, padded as BufferSource),
  );

  const header = new Uint8Array(5);
  new DataView(header.buffer).setUint32(0, recordSize, false);
  header[4] = asPublic.length;

  return concat(salt, header, asPublic, ciphertext);
}

/** RFC 8292: an ES256 JWT plus the raw public key, as the Authorization header value. */
export async function vapidAuthorization(params: {
  endpoint: string;
  subject: string;
  publicKey: string;
  privateKey: string;
  expiresInSeconds?: number;
  now?: number;
}): Promise<string> {
  const now = params.now ?? Date.now();
  const aud = new URL(params.endpoint).origin;

  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64urlEncode(
    enc.encode(
      JSON.stringify({
        aud,
        exp: Math.floor(now / 1000) + (params.expiresInSeconds ?? 12 * 60 * 60),
        sub: params.subject,
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;

  const key = await importPrivate(
    b64urlDecode(params.publicKey),
    b64urlDecode(params.privateKey),
    "ECDSA",
    ["sign"],
  );

  // WebCrypto returns the raw r‖s pair, which is precisely what JWS wants —
  // unlike Node's signer, which returns DER and needs unwrapping.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput) as BufferSource),
  );

  return `vapid t=${signingInput}.${b64urlEncode(signature)}, k=${params.publicKey}`;
}

export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
export type Vapid = { subject: string; publicKey: string; privateKey: string };

/** Sends one push. Returns the push service's HTTP status. */
export async function sendPush(
  subscription: Subscription,
  payload: string,
  vapid: Vapid,
  ttlSeconds = 3 * 60 * 60,
): Promise<number> {
  const body = await encryptPayload({
    plaintext: enc.encode(payload),
    uaPublic: b64urlDecode(subscription.keys.p256dh),
    authSecret: b64urlDecode(subscription.keys.auth),
  });

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization({ endpoint: subscription.endpoint, ...vapid }),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttlSeconds),
      Urgency: "high",
    },
    body: body as BodyInit,
  });

  return res.status;
}
