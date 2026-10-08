import { TripRole } from '@prisma/client';

export interface InvitationEmailParams {
  tripName: string;
  destination: string;
  inviterName: string;
  role: TripRole;
  expiresAt: Date;
  acceptUrl: string;
}

/** Escapa texto para HTML (conteúdo vindo de usuários: nome da viagem, destino, nome do remetente). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Texto para assunto/linhas simples: sem quebras de linha e com tamanho limitado. */
function singleLine(value: string, max: number): string {
  const clean = value.replace(/[\r\n\t]+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const ROLE_LABEL: Record<TripRole, string> = {
  OWNER: 'proprietário',
  EDITOR: 'editar o roteiro',
  VIEWER: 'visualizar o roteiro',
};

function formatExpiry(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

/**
 * E-mail de convite (HTML + texto simples). Todo conteúdo fornecido por
 * usuários é escapado no HTML. O link carrega o token: nunca registre o
 * resultado desta função em logs.
 */
export function renderInvitationEmail(p: InvitationEmailParams) {
  const inviter = singleLine(p.inviterName, 80);
  const trip = singleLine(p.tripName, 120);
  const destination = singleLine(p.destination, 160);
  const role = ROLE_LABEL[p.role];
  const expiry = formatExpiry(p.expiresAt);
  const url = p.acceptUrl;

  const subject = singleLine(`${inviter} convidou você para a viagem "${trip}" no BoraAli`, 180);

  const text = [
    `Olá!`,
    ``,
    `${inviter} convidou você para ${role} da viagem "${trip}" (${destination}) no BoraAli.`,
    ``,
    `Aceite o convite: ${url}`,
    ``,
    `O convite vale até ${expiry} (horário de Brasília). Para aceitar, entre com a conta deste e-mail.`,
    `Se você não esperava este convite, pode ignorar esta mensagem.`,
  ].join('\n');

  const h = escapeHtml;
  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${h(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:Arial,Helvetica,sans-serif;color:#1f2a2e;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td style="font-size:20px;font-weight:bold;color:#2A5F52;padding-bottom:16px;">BoraAli</td></tr>
        <tr><td style="font-size:16px;line-height:24px;padding-bottom:16px;">
          <strong>${h(inviter)}</strong> convidou você para <strong>${h(role)}</strong> da viagem
          <strong>&ldquo;${h(trip)}&rdquo;</strong> (${h(destination)}).
        </td></tr>
        <tr><td style="padding:8px 0 24px;">
          <a href="${h(url)}" style="display:inline-block;background:#E0603F;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px;">Aceitar convite</a>
        </td></tr>
        <tr><td style="font-size:14px;line-height:20px;color:#55626a;">
          O convite vale até <strong>${h(expiry)}</strong> (horário de Brasília). Para aceitar, entre com a conta deste e-mail.<br>
          Se o botão não funcionar, copie este endereço no navegador:<br>
          <span style="word-break:break-all;color:#2A5F52;">${h(url)}</span>
        </td></tr>
        <tr><td style="font-size:12px;color:#8a959b;padding-top:24px;">Se você não esperava este convite, pode ignorar esta mensagem.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
