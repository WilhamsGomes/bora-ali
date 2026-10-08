import { PLAN_FEATURES } from '../src/modules/entitlements/plan-policy';
import { activity, createTestApp, createTrip, createUser, resetDb, TestContext, TestUser } from './helpers';

const FREE_LIMIT = PLAN_FEATURES.FREE.maxActivitiesPerDay!;

describe('Viagens, dias e atividades', () => {
  let ctx: TestContext;
  let owner: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(ctx);
    owner = await createUser(ctx, 'Ana');
  });
  afterAll(() => ctx.app.close());

  const post = (tripId: string, dayId: string, body: object) =>
    ctx.http().post(`/api/v1/trips/${tripId}/days/${dayId}/activities`).set(owner.auth).send(body);

  describe('viagens', () => {
    it('cria dias para cada data local, sem deslocamento de fuso', async () => {
      const trip = await createTrip(ctx, owner, { startDate: '2026-12-30', endDate: '2027-01-02' });
      expect(trip.days.map((d) => d.date)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
      const res = await ctx.http().get(`/api/v1/trips/${trip.id}`).set(owner.auth).expect(200);
      expect(res.body).toMatchObject({ startDate: '2026-12-30', endDate: '2027-01-02', plan: 'FREE', role: 'OWNER' });
    });

    it('valida fuso IANA e intervalo de datas', async () => {
      const base = { name: 'X', destination: 'Y', startDate: '2026-12-20', endDate: '2026-12-22' };
      const tz = await ctx.http().post('/api/v1/trips').set(owner.auth).send({ ...base, timeZone: 'Lisboa/Centro' }).expect(400);
      expect(tz.body.code).toBe('VALIDATION_ERROR');
      const range = await ctx
        .http()
        .post('/api/v1/trips')
        .set(owner.auth)
        .send({ ...base, startDate: '2026-12-22', endDate: '2026-12-20', timeZone: 'Europe/Lisbon' })
        .expect(400);
      expect(range.body.code).toBe('INVALID_DATE_RANGE');
    });

    it('lista viagens próprias e recebidas por convite', async () => {
      const other = await createUser(ctx, 'Bruno');
      const mine = await createTrip(ctx, owner);
      const theirs = await createTrip(ctx, other, { plan: 'PRO' });
      await ctx.prisma.tripMember.create({ data: { tripId: theirs.id, userId: owner.id, role: 'VIEWER' } });

      const all = await ctx.http().get('/api/v1/trips').set(owner.auth).expect(200);
      expect(all.body.map((t: { id: string }) => t.id).sort()).toEqual([mine.id, theirs.id].sort());
      const shared = await ctx.http().get('/api/v1/trips?scope=shared').set(owner.auth).expect(200);
      expect(shared.body).toEqual([expect.objectContaining({ id: theirs.id, role: 'VIEWER', ownerName: 'Bruno', accessible: true })]);
    });

    it('alterar datas preserva dias, cria novos e exige confirmação para remover atividades', async () => {
      const trip = await createTrip(ctx, owner, { startDate: '2026-12-20', endDate: '2026-12-22' });
      const [d20, d21] = trip.days;
      await post(trip.id, d20.id, activity('Chegada', '10:00')).expect(201);

      // Sem confirmação: conflito com os dias afetados, nada muda.
      const conflict = await ctx
        .http()
        .patch(`/api/v1/trips/${trip.id}`)
        .set(owner.auth)
        .send({ startDate: '2026-12-21', endDate: '2026-12-24' })
        .expect(409);
      expect(conflict.body.code).toBe('TRIP_DATE_CHANGE_CONFLICT');
      expect(conflict.body.details.affectedDays).toEqual([{ dayId: d20.id, date: '2026-12-20', activityCount: 1 }]);
      expect(await ctx.prisma.activity.count()).toBe(1);

      // Com confirmação explícita.
      const ok = await ctx
        .http()
        .patch(`/api/v1/trips/${trip.id}`)
        .set(owner.auth)
        .send({ startDate: '2026-12-21', endDate: '2026-12-24', confirmRemoveDates: ['2026-12-20'] })
        .expect(200);
      expect(ok.body.days.map((d: { date: string }) => d.date)).toEqual(['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24']);
      expect(ok.body.days[0].id).toBe(d21.id); // dia preservado
      expect(await ctx.prisma.activity.count()).toBe(0);
    });

    it('dias vazios fora do período são removidos sem confirmação', async () => {
      const trip = await createTrip(ctx, owner);
      const res = await ctx.http().patch(`/api/v1/trips/${trip.id}`).set(owner.auth).send({ endDate: '2026-12-20' }).expect(200);
      expect(res.body.days).toHaveLength(1);
    });
  });

  describe('atividades', () => {
    it('ordena por horário e desempata pela posição; alterar horário reposiciona', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO' });
      const day = trip.days[0].id;
      const b = (await post(trip.id, day, activity('B', '10:00')).expect(201)).body.activity;
      const c = (await post(trip.id, day, activity('C', '10:00')).expect(201)).body.activity;
      const a = (await post(trip.id, day, activity('A', '08:00')).expect(201)).body.activity;

      let res = await ctx.http().get(`/api/v1/trips/${trip.id}/days/${day}`).set(owner.auth).expect(200);
      expect(res.body.activities.map((x: { title: string }) => x.title)).toEqual(['A', 'B', 'C']);

      // Reordenar só o desempate do mesmo horário.
      res = await ctx
        .http()
        .put(`/api/v1/trips/${trip.id}/days/${day}/activities/order`)
        .set(owner.auth)
        .send({ items: [a, c, b].map(({ id, version }) => ({ id, version })) })
        .expect(200);
      expect(res.body.activities.map((x: { title: string }) => x.title)).toEqual(['A', 'C', 'B']);

      // Ordem que contraria os horários é recusada.
      const fresh = res.body.activities as { id: string; version: number }[];
      const bad = await ctx
        .http()
        .put(`/api/v1/trips/${trip.id}/days/${day}/activities/order`)
        .set(owner.auth)
        .send({ items: [fresh[1], fresh[0], fresh[2]].map(({ id, version }) => ({ id, version })) })
        .expect(422);
      expect(bad.body.code).toBe('INVALID_REORDER');

      // Mudar o horário de A para 10:00 coloca A no fim do novo horário.
      const aNow = fresh[0];
      await ctx
        .http()
        .patch(`/api/v1/trips/${trip.id}/activities/${aNow.id}`)
        .set(owner.auth)
        .send({ version: aNow.version, time: '10:00' })
        .expect(200);
      res = await ctx.http().get(`/api/v1/trips/${trip.id}/days/${day}`).set(owner.auth).expect(200);
      expect(res.body.activities.map((x: { title: string }) => x.title)).toEqual(['C', 'B', 'A']);
    });

    it('avisa sobreposição com duração definida sem impedir o salvamento', async () => {
      const trip = await createTrip(ctx, owner);
      const day = trip.days[0].id;
      await post(trip.id, day, activity('Museu', '10:00', { durationMinutes: 120 })).expect(201);
      const res = await post(trip.id, day, activity('Almoço', '11:30')).expect(201);
      expect(res.body.warnings).toEqual([
        expect.objectContaining({ code: 'TIME_OVERLAP', overlapsWithActivityId: res.body.activity.id }),
      ]);
      const sem = await post(trip.id, day, activity('Café', '13:00')).expect(201);
      expect(sem.body.warnings).toEqual([]);
    });

    it('controle de versão: retorna VERSION_CONFLICT com a versão atual', async () => {
      const trip = await createTrip(ctx, owner);
      const created = (await post(trip.id, trip.days[0].id, activity('Passeio', '09:00')).expect(201)).body.activity;
      const url = `/api/v1/trips/${trip.id}/activities/${created.id}`;

      await ctx.http().patch(url).set(owner.auth).send({ version: 1, title: 'Editado por A' }).expect(200);
      const stale = await ctx.http().patch(url).set(owner.auth).send({ version: 1, title: 'Editado por B' }).expect(409);
      expect(stale.body.code).toBe('VERSION_CONFLICT');
      expect(stale.body.details).toMatchObject({ currentVersion: 2, current: { title: 'Editado por A' } });

      await ctx.http().delete(`${url}?version=1`).set(owner.auth).expect(409);
      await ctx.http().delete(`${url}?version=2`).set(owner.auth).expect(204);
    });

    it('permite limpar campos opcionais com null e exige coordenadas em par', async () => {
      const trip = await createTrip(ctx, owner);
      const created = (
        await post(trip.id, trip.days[0].id, activity('X', '09:00', { location: 'Praça', latitude: 1, longitude: 2 })).expect(201)
      ).body.activity;
      const url = `/api/v1/trips/${trip.id}/activities/${created.id}`;
      const res = await ctx.http().patch(url).set(owner.auth).send({ version: 1, location: null }).expect(200);
      expect(res.body.activity.location).toBeNull();
      const bad = await ctx.http().patch(url).set(owner.auth).send({ version: 2, latitude: null }).expect(400);
      expect(bad.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('limite do plano FREE', () => {
    it(`bloqueia a ${FREE_LIMIT + 1}ª atividade do dia, para qualquer categoria`, async () => {
      const trip = await createTrip(ctx, owner);
      const day = trip.days[0].id;
      const cats = ['transporte', 'hospedagem', 'descanso', 'passeio', 'alimentacao', 'outros'];
      for (let i = 0; i < FREE_LIMIT; i++) {
        await post(trip.id, day, activity(`a${i}`, '09:00', { category: cats[i % cats.length] })).expect(201);
      }
      const res = await post(trip.id, day, activity('Outra', '10:00')).expect(403);
      expect(res.body.code).toBe('DAILY_ACTIVITY_LIMIT_REACHED');
      expect(res.body.details).toMatchObject({ limit: FREE_LIMIT, currentCount: FREE_LIMIT });
    });

    it('protege o limite contra requisições concorrentes', async () => {
      const trip = await createTrip(ctx, owner);
      const day = trip.days[0].id;
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => post(trip.id, day, activity(`Rolê ${i}`, '10:00'))),
      );
      const created = results.filter((r) => r.status === 201).length;
      const limited = results.filter((r) => r.body.code === 'DAILY_ACTIVITY_LIMIT_REACHED').length;
      expect(created).toBe(FREE_LIMIT);
      expect(limited).toBe(10 - FREE_LIMIT);
      expect(await ctx.prisma.activity.count({ where: { dayId: day } })).toBe(FREE_LIMIT);
    });

    it('adição em lote é atômica e respeita o limite por dia', async () => {
      const trip = await createTrip(ctx, owner);
      const [d1, d2] = trip.days;
      // Um item a mais que o limite no 1º dia, e um no 2º
      const items = [
        ...Array.from({ length: FREE_LIMIT + 1 }, (_, i) => ({ ...activity(`a${i}`, '09:00'), dayId: d1.id })),
        { ...activity('c', '09:00'), dayId: d2.id },
      ];
      const res = await ctx.http().post(`/api/v1/trips/${trip.id}/activities/batch`).set(owner.auth).send({ items }).expect(403);
      expect(res.body.code).toBe('DAILY_ACTIVITY_LIMIT_REACHED');
      expect(await ctx.prisma.activity.count()).toBe(0); // nada foi criado

      const ok = await ctx
        .http()
        .post(`/api/v1/trips/${trip.id}/activities/batch`)
        .set(owner.auth)
        .send({ items: items.slice(1) })
        .expect(201);
      expect(ok.body.activities).toHaveLength(FREE_LIMIT + 1);
    });

    it('lotes concorrentes não ultrapassam o limite', async () => {
      const trip = await createTrip(ctx, owner);
      const day = trip.days[0].id;
      // Cada lote cabe sozinho, mas dois juntos passam do limite
      const size = Math.floor(FREE_LIMIT / 2) + 1;
      const batch = { items: Array.from({ length: size }, (_, i) => ({ ...activity(`x${i}`, '09:00'), dayId: day })) };
      const results = await Promise.all(
        [0, 1, 2].map(() => ctx.http().post(`/api/v1/trips/${trip.id}/activities/batch`).set(owner.auth).send(batch)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await ctx.prisma.activity.count({ where: { dayId: day } })).toBe(size);
    });

    it('verifica o limite ao mover atividade entre dias', async () => {
      const trip = await createTrip(ctx, owner);
      const [d1, d2] = trip.days;
      for (let i = 0; i < FREE_LIMIT; i++) await post(trip.id, d1.id, activity(`a${i}`, `1${i}:00`)).expect(201);
      const moving = (await post(trip.id, d2.id, activity('Mover', '08:00')).expect(201)).body.activity;

      const res = await ctx
        .http()
        .patch(`/api/v1/trips/${trip.id}/activities/${moving.id}`)
        .set(owner.auth)
        .send({ version: moving.version, dayId: d1.id })
        .expect(403);
      expect(res.body.code).toBe('DAILY_ACTIVITY_LIMIT_REACHED');
    });

    it('após voltar ao FREE, dia acima do limite permite consultar/editar/excluir mas não adicionar', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO' });
      const day = trip.days[0].id;
      const created = [];
      // Dois acima do limite: excluir uma ainda deixa o dia acima do limite
      for (let i = 0; i < FREE_LIMIT + 2; i++) {
        created.push((await post(trip.id, day, activity(`a${i}`, `1${i}:00`)).expect(201)).body.activity);
      }
      await ctx.prisma.trip.update({ where: { id: trip.id }, data: { plan: 'FREE' } });

      const dayRes = await ctx.http().get(`/api/v1/trips/${trip.id}/days/${day}`).set(owner.auth).expect(200);
      expect(dayRes.body.activities).toHaveLength(FREE_LIMIT + 2);
      expect(dayRes.body.canAddActivities).toBe(false);

      await ctx
        .http()
        .patch(`/api/v1/trips/${trip.id}/activities/${created[0].id}`)
        .set(owner.auth)
        .send({ version: 1, title: 'Editada' })
        .expect(200);
      await ctx.http().delete(`/api/v1/trips/${trip.id}/activities/${created[1].id}`).set(owner.auth).expect(204);
      const add = await post(trip.id, day, activity('Nova', '18:00')).expect(403);
      expect(add.body.code).toBe('DAILY_ACTIVITY_LIMIT_REACHED');
      expect(await ctx.prisma.activity.count()).toBe(FREE_LIMIT + 1);
    });
  });
});
