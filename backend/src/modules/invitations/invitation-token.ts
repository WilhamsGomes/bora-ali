import { createHmac, hkdfSync } from 'node:crypto';

/**
 * Token do convite = HMAC(chave do servidor, `${invitationId}.${nonce}`).
 * O banco guarda só o nonce e o hash do token; sem a chave (derivada do
 * JWT_ACCESS_SECRET via HKDF, com rótulo próprio) não é possível reconstruí-lo.
 * Isso permite reenviar o mesmo link sem armazenar o token nem invalidar o convite.
 * Trocar JWT_ACCESS_SECRET invalida os links de convites pendentes.
 */
export function invitationTokenKey(serverSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', serverSecret, 'boraali', 'invitation-token-v1', 32));
}

export function deriveInvitationToken(key: Buffer, invitationId: string, nonce: string): string {
  return createHmac('sha256', key).update(`${invitationId}.${nonce}`).digest('base64url');
}
