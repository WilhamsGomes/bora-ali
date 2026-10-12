import { AuthService } from '../src/modules/auth/auth.service';
import { activity, addMember, createTestApp, createTrip, createUser, resetDb, TestContext, TestUser } from './helpers';

interface OutboxItem {
  to: string;
  text: string;
}

describe('Autorização, convites e compartilhamento', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(ctx);
    await ctx.http().delete('/api/v1/dev/outbox').expect(204);
    owner = await createUser(ctx, 'Ana');
    editor = await createUser(ctx, 'Bruno');
    viewer = await createUser(ctx, 'Carla');
    stranger = await createUser(ctx, 'Estranho');
  });
  afterAll(() => ctx.app.close());

  async function proTripWithMembers() {
    const trip = await createTrip(ctx, owner);
    await addMember(ctx, trip.id, editor, 'EDITOR');
    await addMember(ctx, trip.id, viewer, 'VIEWER');
    return trip;
  }

  async function lastInviteToken(): Promise<string> {
    const res = await ctx.http().get('/api/v1/dev/outbox').expect(200);
    const text = (res.body as OutboxItem[])[0].text;
    return decodeURIComponent(/convites\/([^\s]+)/.exec(text)![1]);
  }

  describe('papéis', () => {
    it('VIEWER lê mas não escreve; EDITOR gerencia atividades; não membro recebe 404', async () => {
      const trip = await proTripWithMembers();
      const day = trip.days[0].id;
      const url = `/api/v1/trips/${trip.id}/days/${day}/activities`;

      await ctx.http().get(`/api/v1/trips/${trip.id}`).set(viewer.auth).expect(200);
      const denied = await ctx.http().post(url).set(viewer.auth).send(activity('x', '09:00')).expect(403);
      expect(denied.body.code).toBe('FORBIDDEN');

      const created = await ctx.http().post(url).set(editor.auth).send(activity('y', '09:00')).expect(201);
      await ctx
        .http()
        .patch(`/api/v1/trips/${trip.id}/activities/${created.body.activity.id}`)
        .set(editor.auth)
        .send({ version: 1, title: 'z' })
        .expect(200);

      const hidden = await ctx.http().get(`/api/v1/trips/${trip.id}`).set(stranger.auth).expect(404);
      expect(hidden.body.code).toBe('TRIP_NOT_FOUND');
    });

    it('somente o OWNER edita a viagem, convida e compartilha', async () => {
      const trip = await proTripWithMembers();
      await ctx.http().patch(`/api/v1/trips/${trip.id}`).set(editor.auth).send({ name: 'x' }).expect(403);
      await ctx.http().delete(`/api/v1/trips/${trip.id}`).set(editor.auth).expect(403);
      await ctx
        .http()
        .post(`/api/v1/trips/${trip.id}/invitations`)
        .set(editor.auth)
        .send({ email: 'x@teste.dev', role: 'VIEWER' })
        .expect(403);
      await ctx.http().put(`/api/v1/trips/${trip.id}/share`).set(editor.auth).send({ enabled: true }).expect(403);
    });

    it('entitlements trazem limite fixo, papel e IA, sem plano nem compra', async () => {
      const trip = await proTripWithMembers();
      const asOwner = await ctx.http().get(`/api/v1/trips/${trip.id}/entitlements`).set(owner.auth).expect(200);
      expect(asOwner.body).toEqual({
        tripId: trip.id,
        role: 'OWNER',
        maxActivitiesPerDay: 10,
        ai: expect.objectContaining({
          available: true,
          canRequest: true,
          usage: expect.objectContaining({ DAY_SUGGESTIONS: { limit: 2, used: 0, reserved: 0, remaining: 2 } }),
        }),
      });
      const asViewer = await ctx.http().get(`/api/v1/trips/${trip.id}/entitlements`).set(viewer.auth).expect(200);
      expect(asViewer.body).toMatchObject({ role: 'VIEWER', ai: { canRequest: false } });
    });
  });

  describe('convites', () => {
    it('fluxo completo: envio, token com hash, aceite com e-mail correto e sem duplicidade', async () => {
      const trip = await createTrip(ctx, owner);
      const guestEmail = 'convidado@teste.dev';
      const inv = await ctx
        .http()
        .post(`/api/v1/trips/${trip.id}/invitations`)
        .set(owner.auth)
        .send({ email: 'Convidado@Teste.dev', role: 'EDITOR' })
        .expect(201);
      expect(inv.body).toMatchObject({ email: guestEmail, role: 'EDITOR', status: 'PENDING' });
      expect(inv.body).not.toHaveProperty('token');

      const token = await lastInviteToken();
      const stored = await ctx.prisma.invitation.findFirstOrThrow();
      expect(stored.tokenHash).not.toContain(token);

      const preview = await ctx.http().post('/api/v1/invitations/preview').send({ token }).expect(200);
      expect(preview.body).toMatchObject({ tripName: 'Viagem de teste', role: 'EDITOR', emailHint: 'co***@teste.dev' });

      // Outra conta não pode aceitar.
      const mismatch = await ctx.http().post('/api/v1/invitations/accept').set(stranger.auth).send({ token }).expect(403);
      expect(mismatch.body.code).toBe('INVITATION_EMAIL_MISMATCH');

      const guest = await ctx.app.get(AuthService).register({ name: 'Convidado', email: guestEmail, password: 'senha-segura-123' }, {});
      const auth = { Authorization: `Bearer ${guest.accessToken}` };
      const accepted = await ctx.http().post('/api/v1/invitations/accept').set(auth).send({ token }).expect(200);
      expect(accepted.body).toEqual({ tripId: trip.id, role: 'EDITOR' });

      // Token já usado.
      const again = await ctx.http().post('/api/v1/invitations/accept').set(auth).send({ token }).expect(404);
      expect(again.body.code).toBe('INVITATION_INVALID');
      expect(await ctx.prisma.tripMember.count({ where: { tripId: trip.id, userId: guest.user.id } })).toBe(1);

      // Já é participante: novo convite é recusado.
      const dup = await ctx
        .http()
        .post(`/api/v1/trips/${trip.id}/invitations`)
        .set(owner.auth)
        .send({ email: guestEmail, role: 'VIEWER' })
        .expect(409);
      expect(dup.body.code).toBe('ALREADY_MEMBER');
    });

    it('convite revogado ou expirado não pode ser aceito', async () => {
      const trip = await createTrip(ctx, owner);
      const inv = await ctx
        .http()
        .post(`/api/v1/trips/${trip.id}/invitations`)
        .set(owner.auth)
        .send({ email: viewer.email, role: 'VIEWER' })
        .expect(201);
      const token = await lastInviteToken();
      await ctx.http().delete(`/api/v1/trips/${trip.id}/invitations/${inv.body.id}`).set(owner.auth).expect(204);
      await ctx.http().post('/api/v1/invitations/accept').set(viewer.auth).send({ token }).expect(404);

      await ctx.http().post(`/api/v1/trips/${trip.id}/invitations`).set(owner.auth).send({ email: viewer.email, role: 'VIEWER' }).expect(201);
      const token2 = await lastInviteToken();
      await ctx.prisma.invitation.updateMany({ where: { revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await ctx.http().post('/api/v1/invitations/accept').set(viewer.auth).send({ token: token2 }).expect(404);
    });

    it('proprietário altera papel e remove convidado, mas não pode ser removido', async () => {
      const trip = await proTripWithMembers();
      const changed = await ctx
        .http()
        .patch(`/api/v1/trips/${trip.id}/members/${viewer.id}`)
        .set(owner.auth)
        .send({ role: 'EDITOR' })
        .expect(200);
      expect(changed.body.role).toBe('EDITOR');

      const own = await ctx.http().delete(`/api/v1/trips/${trip.id}/members/${owner.id}`).set(owner.auth).expect(403);
      expect(own.body.code).toBe('CANNOT_MODIFY_OWNER');
      await ctx.http().patch(`/api/v1/trips/${trip.id}/members/${owner.id}`).set(owner.auth).send({ role: 'VIEWER' }).expect(403);
      await ctx.http().delete(`/api/v1/trips/${trip.id}/members/${owner.id}`).set(editor.auth).expect(403);

      await ctx.http().delete(`/api/v1/trips/${trip.id}/members/${viewer.id}`).set(owner.auth).expect(204);
      await ctx.http().get(`/api/v1/trips/${trip.id}`).set(viewer.auth).expect(404);

      // Convidado pode sair por conta própria.
      await ctx.http().delete(`/api/v1/trips/${trip.id}/members/${editor.id}`).set(editor.auth).expect(204);
      const members = await ctx.http().get(`/api/v1/trips/${trip.id}/members`).set(owner.auth).expect(200);
      expect(members.body).toEqual([expect.objectContaining({ userId: owner.id, role: 'OWNER' })]);
    });
  });

  describe('link público', () => {
    it('somente leitura, sem dados pessoais, notas opcionais, renovável e desativável', async () => {
      const trip = await proTripWithMembers();
      await ctx
        .http()
        .post(`/api/v1/trips/${trip.id}/days/${trip.days[0].id}/activities`)
        .set(owner.auth)
        .send(activity('Museu', '10:00', { notes: 'Levar carteirinha' }))
        .expect(201);

      const share = await ctx.http().put(`/api/v1/trips/${trip.id}/share`).set(owner.auth).send({ enabled: true }).expect(200);
      expect(share.body).toMatchObject({ enabled: true, active: true, showNotes: false });
      const token = share.body.token as string;

      const pub = await ctx.http().get(`/api/v1/public/trips/${token}`).expect(200);
      const body = JSON.stringify(pub.body);
      for (const forbidden of [owner.email, editor.email, 'ownerId', 'plan', 'tripId', '"id"', 'Levar carteirinha']) {
        expect(body).not.toContain(forbidden);
      }
      expect(pub.body.days[0].activities[0]).toMatchObject({ title: 'Museu', time: '10:00' });

      await ctx.http().put(`/api/v1/trips/${trip.id}/share`).set(owner.auth).send({ enabled: true, showNotes: true }).expect(200);
      const withNotes = await ctx.http().get(`/api/v1/public/trips/${token}`).expect(200);
      expect(withNotes.body.days[0].activities[0].notes).toBe('Levar carteirinha');

      const rotated = await ctx.http().post(`/api/v1/trips/${trip.id}/share/rotate`).set(owner.auth).expect(200);
      expect(rotated.body.token).not.toBe(token);
      await ctx.http().get(`/api/v1/public/trips/${token}`).expect(404);
      await ctx.http().get(`/api/v1/public/trips/${rotated.body.token}`).expect(200);

      await ctx.http().put(`/api/v1/trips/${trip.id}/share`).set(owner.auth).send({ enabled: false }).expect(200);
      const off = await ctx.http().get(`/api/v1/public/trips/${rotated.body.token}`).expect(404);
      expect(off.body.code).toBe('SHARE_LINK_NOT_FOUND');
    });

    it('qualquer viagem pode ativar o link público; desativar volta a esconder', async () => {
      const trip = await createTrip(ctx, owner);
      const share = await ctx.http().put(`/api/v1/trips/${trip.id}/share`).set(owner.auth).send({ enabled: true }).expect(200);
      expect(share.body).toMatchObject({ enabled: true, active: true });
      await ctx.http().get(`/api/v1/public/trips/${share.body.token}`).expect(200);
      await ctx.http().put(`/api/v1/trips/${trip.id}/share`).set(owner.auth).send({ enabled: false }).expect(200);
      await ctx.http().get(`/api/v1/public/trips/${share.body.token}`).expect(404);
    });
  });
});
