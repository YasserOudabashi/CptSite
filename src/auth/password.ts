import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Hash lento con scrypt (incluso in Node, nessuna dipendenza). Formato: salt:hash in esadecimale.
function derive(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(secret, salt, 64, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await derive(secret, salt)).toString('hex')}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await derive(secret, Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
