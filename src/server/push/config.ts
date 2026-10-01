import { createECDH } from 'node:crypto';

export function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject || !/^mailto:[^\s@]+@[^\s@]+$/.test(subject)) return null;
  try {
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (key.getPublicKey().toString('base64url') !== publicKey) return null;
    return { publicKey, privateKey, subject };
  } catch {
    return null;
  }
}
