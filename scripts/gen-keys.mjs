/** VAPID keys and secrets, generated with WebCrypto only — no dependencies. */

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = b64url(await crypto.subtle.exportKey("raw", pair.publicKey));
const { d: privateKey } = await crypto.subtle.exportKey("jwk", pair.privateKey);

const secret = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

console.log(`
Paste these into .env.local (and into your host's environment variables):

NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
SESSION_SECRET=${secret(32)}
CRON_SECRET=${secret(24)}
`);
