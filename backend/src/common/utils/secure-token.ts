import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token aleatório imprevisível (256 bits), seguro para URLs. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Hash para tokens de alta entropia (refresh, convite). SHA-256 basta aqui:
 * o token já é aleatório, então não há dicionário a atacar.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
