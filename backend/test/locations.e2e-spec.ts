import { GeocodingProviderError } from '../src/modules/locations/geocoding-provider';
import { LocationsService } from '../src/modules/locations/locations.service';
import { place } from './fakes';
import { activity, addMember, createTestApp, createTrip, createUser, resetDb, TestContext, TestUser } from './helpers';

const MARCO_ZERO = {
  formattedAddress: 'Marco Zero, Praça Rio Branco, Recife - PE, Brasil',
  latitude: -8.0631,
  longitude: -34.8711,
  placeId: 'geo-marco-zero-recife',
  placeProvider: 'geoapify',
};
const RECIFE = {
  latitude: -8.0578,
  longitude: -34.8829,
  formattedAddress: 'Recife, Pernambuco, Brasil',
  placeId: 'geo-recife',
  provider: 'geoapify',
};

describe('Localizações: lugares das atividades, destino e busca', () => {
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

  const api = (path: string) => `/api/v1/trips/${path}`;

  describe('lugar da atividade', () => {
    it('persiste coordenadas, endereço e identificação do lugar selecionado', async () => {
      const trip = await createTrip(ctx, owner);
      const created = await ctx
        .http()
        .post(api(`${trip.id}/days/${trip.days[0].id}/activities`))
        .set(owner.auth)
        .send(activity('Marco Zero', '09:00', { location: 'Marco Zero', ...MARCO_ZERO }))
        .expect(201);
      expect(created.body.activity).toMatchObject({ location: 'Marco Zero', ...MARCO_ZERO });

      const detail = await ctx.http().get(api(trip.id)).set(owner.auth).expect(200);
      expect(detail.body.days[0].activities[0]).toMatchObject(MARCO_ZERO);
    });

    it('aceita texto livre sem coordenadas', async () => {
      const trip = await createTrip(ctx, owner);
      const res = await ctx
        .http()
        .post(api(`${trip.id}/days/${trip.days[0].id}/activities`))
        .set(owner.auth)
        .send(activity('Feirinha', '10:00', { location: 'Feirinha do bairro' }))
        .expect(201);
      expect(res.body.activity).toMatchObject({
        location: 'Feirinha do bairro',
        latitude: null,
        longitude: null,
        placeId: null,
        placeProvider: null,
        formattedAddress: null,
      });
    });

    it.each([
      ['latitude sem longitude', { latitude: -8.06 }],
      ['placeId sem provedor', { latitude: -8.06, longitude: -34.87, placeId: 'x' }],
      ['placeId sem coordenadas', { placeId: 'x', placeProvider: 'geoapify' }],
    ])('recusa lugar inconsistente: %s', async (_label, place) => {
      const trip = await createTrip(ctx, owner);
      const res = await ctx
        .http()
        .post(api(`${trip.id}/days/${trip.days[0].id}/activities`))
        .set(owner.auth)
        .send(activity('X', '10:00', { location: 'X', ...place }))
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(await ctx.prisma.activity.count()).toBe(0);
    });

    it('recusa coordenadas fora dos limites e provedor desconhecido', async () => {
      const trip = await createTrip(ctx, owner);
      const url = api(`${trip.id}/days/${trip.days[0].id}/activities`);
      await ctx.http().post(url).set(owner.auth).send(activity('X', '10:00', { latitude: 91, longitude: 0 })).expect(400);
      await ctx
        .http()
        .post(url)
        .set(owner.auth)
        .send(activity('X', '10:00', { latitude: 1, longitude: 1, placeId: 'p', placeProvider: 'outro' }))
        .expect(400);
    });

    it('limpa coordenadas e identificação quando o texto do local muda sem novo lugar', async () => {
      const trip = await createTrip(ctx, owner);
      const created = await ctx
        .http()
        .post(api(`${trip.id}/days/${trip.days[0].id}/activities`))
        .set(owner.auth)
        .send(activity('Passeio', '09:00', { location: 'Marco Zero', ...MARCO_ZERO }))
        .expect(201);
      const id = created.body.activity.id;

      // Outros campos mudam: o lugar continua.
      const renamed = await ctx
        .http()
        .patch(api(`${trip.id}/activities/${id}`))
        .set(owner.auth)
        .send({ version: 1, title: 'Passeio no centro', location: 'Marco Zero' })
        .expect(200);
      expect(renamed.body.activity).toMatchObject(MARCO_ZERO);

      // Texto do local muda: coordenadas antigas não valem mais.
      const changed = await ctx
        .http()
        .patch(api(`${trip.id}/activities/${id}`))
        .set(owner.auth)
        .send({ version: 2, location: 'Paço do Frevo' })
        .expect(200);
      expect(changed.body.activity).toMatchObject({
        location: 'Paço do Frevo',
        latitude: null,
        longitude: null,
        placeId: null,
        placeProvider: null,
        formattedAddress: null,
      });
    });

    it('substitui o lugar inteiro quando um novo lugar é enviado', async () => {
      const trip = await createTrip(ctx, owner);
      const created = await ctx
        .http()
        .post(api(`${trip.id}/days/${trip.days[0].id}/activities`))
        .set(owner.auth)
        .send(activity('Passeio', '09:00', { location: 'Marco Zero', ...MARCO_ZERO }))
        .expect(201);
      // Só coordenadas novas (ex.: lugar ajustado sem provedor): o placeId antigo não sobrevive.
      const res = await ctx
        .http()
        .patch(api(`${trip.id}/activities/${created.body.activity.id}`))
        .set(owner.auth)
        .send({ version: 1, latitude: -8.06, longitude: -34.87 })
        .expect(200);
      expect(res.body.activity).toMatchObject({ latitude: -8.06, longitude: -34.87, placeId: null, placeProvider: null, formattedAddress: null });
    });

    it('limpa o lugar com null explícito', async () => {
      const trip = await createTrip(ctx, owner);
      const created = await ctx
        .http()
        .post(api(`${trip.id}/days/${trip.days[0].id}/activities`))
        .set(owner.auth)
        .send(activity('Passeio', '09:00', { location: 'Marco Zero', ...MARCO_ZERO }))
        .expect(201);
      const res = await ctx
        .http()
        .patch(api(`${trip.id}/activities/${created.body.activity.id}`))
        .set(owner.auth)
        .send({ version: 1, latitude: null, longitude: null, placeId: null, placeProvider: null, formattedAddress: null })
        .expect(200);
      expect(res.body.activity).toMatchObject({ location: 'Marco Zero', latitude: null, placeId: null });
    });

    it('lote (sugestões aplicadas) também valida e persiste o lugar', async () => {
      const trip = await createTrip(ctx, owner);
      const res = await ctx
        .http()
        .post(api(`${trip.id}/activities/batch`))
        .set(owner.auth)
        .send({ items: [{ dayId: trip.days[0].id, ...activity('A', '09:00', { location: 'Marco Zero', ...MARCO_ZERO }) }] })
        .expect(201);
      expect(res.body.activities[0]).toMatchObject(MARCO_ZERO);
    });
  });

  describe('localização do destino', () => {
    it('proprietário confirma o destino; mudar o texto do destino limpa a localização', async () => {
      const trip = await createTrip(ctx, owner);
      const set = await ctx
        .http()
        .patch(api(trip.id))
        .set(owner.auth)
        .send({ destination: 'Recife, PE', destinationPlace: RECIFE })
        .expect(200);
      expect(set.body.destinationPlace).toEqual(RECIFE);

      const renamed = await ctx.http().patch(api(trip.id)).set(owner.auth).send({ name: 'Outro nome' }).expect(200);
      expect(renamed.body.destinationPlace).toEqual(RECIFE);

      const changed = await ctx.http().patch(api(trip.id)).set(owner.auth).send({ destination: 'Olinda' }).expect(200);
      expect(changed.body.destinationPlace).toBeNull();
    });

    it('cria viagem com destino confirmado e recusa localização inconsistente', async () => {
      const base = { name: 'X', destination: 'Recife', startDate: '2026-12-20', endDate: '2026-12-21', timeZone: 'America/Recife' };
      const ok = await ctx.http().post('/api/v1/trips').set(owner.auth).send({ ...base, destinationPlace: RECIFE }).expect(201);
      expect(ok.body.destinationPlace).toEqual(RECIFE);
      await ctx
        .http()
        .post('/api/v1/trips')
        .set(owner.auth)
        .send({ ...base, destinationPlace: { latitude: -8, longitude: -34, placeId: 'sem-provedor' } })
        .expect(400);
      await ctx
        .http()
        .post('/api/v1/trips')
        .set(owner.auth)
        .send({ ...base, destinationPlace: { latitude: -100, longitude: -34 } })
        .expect(400);
    });
  });

  describe('busca de lugares', () => {
    const search = (tripId: string, user: TestUser | null, q: string, kind?: string) => {
      const req = ctx
        .http()
        .get(api(`${tripId}/places/search`))
        .query({ q, ...(kind ? { kind } : {}) });
      return user ? req.set(user.auth) : req;
    };

    it('devolve sugestões com nome, endereço e cidade, orientadas pelo destino confirmado', async () => {
      const trip = await createTrip(ctx, owner);
      ctx.geocoding.results = [
        place(),
        place({ placeId: 'geo-marco-zero-sp', name: 'Marco Zero', city: 'São Paulo', formattedAddress: 'Marco Zero, Praça da Sé, São Paulo - SP, Brasil' }),
      ];

      const before = await search(trip.id, owner, 'Marco Zero').expect(200);
      expect(before.body.biasedToDestination).toBe(false);
      expect(ctx.geocoding.calls[0]).toMatchObject({ text: 'Marco Zero', kind: 'place', near: null, lang: 'pt' });
      // Busca ambígua: todas as opções voltam para a pessoa escolher, com cidade.
      expect(before.body.results.map((r: { city: string }) => r.city)).toEqual(['Recife', 'São Paulo']);
      expect(before.body.attribution).toMatch(/OpenStreetMap/);

      await ctx.http().patch(api(trip.id)).set(owner.auth).send({ destinationPlace: RECIFE }).expect(200);
      const after = await search(trip.id, owner, 'Marco Zero').expect(200);
      expect(after.body.biasedToDestination).toBe(true);
      // Região arredondada a 0,1° (~11 km): a mesma usada na chave do cache.
      expect(ctx.geocoding.calls[1].near).toEqual({ latitude: -8.1, longitude: -34.9 });
    });

    it('remove duplicados e respeita o limite', async () => {
      const trip = await createTrip(ctx, owner);
      ctx.geocoding.results = [place(), place(), place({ placeId: 'b' }), place({ placeId: 'c' })];
      const res = await ctx.http().get(api(`${trip.id}/places/search`)).query({ q: 'marco', limit: 2 }).set(owner.auth).expect(200);
      expect(res.body.results.map((r: { placeId: string }) => r.placeId)).toEqual(['geo-marco-zero-recife', 'b']);
    });

    it('usa cache para consultas equivalentes', async () => {
      const trip = await createTrip(ctx, owner);
      await search(trip.id, owner, 'Marco  Zero').expect(200);
      await search(trip.id, owner, 'marco zero').expect(200);
      expect(ctx.geocoding.calls).toHaveLength(1);
    });

    it('exige autenticação e acesso de edição à viagem', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO' });
      const viewer = await createUser(ctx, 'Vera');
      const editor = await createUser(ctx, 'Edu');
      const stranger = await createUser(ctx, 'Estranho');
      await addMember(ctx, trip.id, viewer, 'VIEWER');
      await addMember(ctx, trip.id, editor, 'EDITOR');

      await search(trip.id, null, 'Marco Zero').expect(401);
      expect((await search(trip.id, stranger, 'Marco Zero').expect(404)).body.code).toBe('TRIP_NOT_FOUND');
      expect((await search(trip.id, viewer, 'Marco Zero').expect(403)).body.code).toBe('FORBIDDEN');
      await search(trip.id, editor, 'Marco Zero').expect(200);
      // Confirmar o destino é ação do proprietário.
      expect((await search(trip.id, editor, 'Recife', 'destination').expect(403)).body.code).toBe('FORBIDDEN');
      await search(trip.id, owner, 'Recife', 'destination').expect(200);
      expect(ctx.geocoding.calls.filter((c) => c.kind === 'destination')).toHaveLength(1);
    });

    it('valida a consulta', async () => {
      const trip = await createTrip(ctx, owner);
      await search(trip.id, owner, 'a').expect(400);
      await search(trip.id, owner, 'x'.repeat(201)).expect(400);
      await search(trip.id, owner, 'Recife', 'qualquer').expect(400);
      expect(ctx.geocoding.calls).toHaveLength(0);
    });

    it('responde indisponível sem chave configurada, sem chamar o provedor', async () => {
      const trip = await createTrip(ctx, owner);
      ctx.geocoding.isConfigured = false;
      const res = await search(trip.id, owner, 'Marco Zero').expect(503);
      expect(res.body.code).toBe('LOCATION_SEARCH_UNAVAILABLE');
      expect(ctx.geocoding.calls).toHaveLength(0);
    });

    it.each([
      ['timeout', 'demorou'],
      ['rate_limited', 'sobrecarregada'],
      ['unauthorized', 'configuração'],
      ['provider', 'indisponível'],
    ] as const)('falha do provedor (%s) vira 502 LOCATION_PROVIDER_ERROR', async (kind, text) => {
      const trip = await createTrip(ctx, owner);
      ctx.geocoding.error = new GeocodingProviderError(kind, 'falha simulada');
      const res = await search(trip.id, owner, `Marco ${kind}`).expect(502);
      expect(res.body).toMatchObject({ code: 'LOCATION_PROVIDER_ERROR', details: { reason: kind } });
      expect(res.body.message).toContain(text);
      // Falhas não ficam em cache.
      ctx.geocoding.error = null;
      await search(trip.id, owner, `Marco ${kind}`).expect(200);
    });

    it('limita consultas ao provedor por usuário', async () => {
      const trip = await createTrip(ctx, owner);
      for (let i = 0; i < 5; i++) await search(trip.id, owner, `lugar ${i}`).expect(200);
      const limited = await search(trip.id, owner, 'lugar 6').expect(429);
      expect(limited.body.code).toBe('RATE_LIMITED');
      // Resultado em cache continua disponível.
      await search(trip.id, owner, 'lugar 1').expect(200);
    });
  });

  describe('cache persistente de buscas', () => {
    const search = (tripId: string, q: string, limit?: number) =>
      ctx
        .http()
        .get(api(`${tripId}/places/search`))
        .query({ q, ...(limit ? { limit } : {}) })
        .set(owner.auth);
    const service = () => ctx.app.get(LocationsService);
    /** Simula reinício do processo / outra instância: só a camada do banco continua. */
    const forgetMemory = () => (service() as unknown as { cache: Map<string, unknown> }).cache.clear();

    it('responde do banco depois que a memória some, sem chamar o provedor', async () => {
      const trip = await createTrip(ctx, owner);
      await search(trip.id, 'Marco Zero').expect(200);
      forgetMemory();
      const again = await search(trip.id, 'Marco Zero').expect(200);
      expect(again.body.results[0]).toMatchObject({ placeId: 'geo-marco-zero-recife', city: 'Recife' });
      expect(ctx.geocoding.calls).toHaveLength(1);
      expect(service().stats).toEqual({ memory: 0, database: 1, provider: 1 });
      const row = await ctx.prisma.placeSearchCache.findFirstOrThrow();
      expect(row).toMatchObject({ query: 'marco zero', kind: 'place', provider: 'fake', hits: 1 });
      // Nada que identifique quem buscou
      expect(Object.keys(row).sort()).toEqual(
        ['createdAt', 'expiresAt', 'hits', 'id', 'key', 'kind', 'lastHitAt', 'provider', 'query', 'results'].sort(),
      );
    });

    it('ignora acentos, maiúsculas e o limite pedido', async () => {
      const trip = await createTrip(ctx, owner);
      ctx.geocoding.results = [place({ placeId: 'a' }), place({ placeId: 'b' }), place({ placeId: 'c' })];
      const few = await search(trip.id, 'Paço do Frevo', 2).expect(200);
      expect(few.body.results).toHaveLength(2);
      forgetMemory();
      const more = await search(trip.id, 'PACO  do frevo', 6).expect(200);
      expect(more.body.results).toHaveLength(3);
      expect(ctx.geocoding.calls).toHaveLength(1);
      expect(ctx.geocoding.calls[0].limit).toBe(8);
    });

    it('viagens para a mesma região compartilham o cache; regiões distantes não', async () => {
      const recife1 = await createTrip(ctx, owner);
      const recife2 = await createTrip(ctx, owner);
      const sp = await createTrip(ctx, owner);
      await ctx.http().patch(api(recife1.id)).set(owner.auth).send({ destinationPlace: RECIFE }).expect(200);
      await ctx
        .http()
        .patch(api(recife2.id))
        .set(owner.auth)
        .send({ destinationPlace: { latitude: -8.0631, longitude: -34.8711 } })
        .expect(200);
      await ctx
        .http()
        .patch(api(sp.id))
        .set(owner.auth)
        .send({ destinationPlace: { latitude: -23.5505, longitude: -46.6333 } })
        .expect(200);

      await search(recife1.id, 'Marco Zero').expect(200);
      await search(recife2.id, 'Marco Zero').expect(200);
      expect(ctx.geocoding.calls).toHaveLength(1);
      await search(sp.id, 'Marco Zero').expect(200);
      expect(ctx.geocoding.calls).toHaveLength(2);
      expect(ctx.geocoding.calls[1].near).toEqual({ latitude: -23.6, longitude: -46.6 });
    });

    it('entrada vencida volta a consultar o provedor e é renovada', async () => {
      const trip = await createTrip(ctx, owner);
      await search(trip.id, 'Marco Zero').expect(200);
      await ctx.prisma.placeSearchCache.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      forgetMemory();
      await search(trip.id, 'Marco Zero').expect(200);
      expect(ctx.geocoding.calls).toHaveLength(2);
      const row = await ctx.prisma.placeSearchCache.findFirstOrThrow();
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);
    });

    it('não persiste respostas vazias', async () => {
      const trip = await createTrip(ctx, owner);
      ctx.geocoding.results = [];
      await search(trip.id, 'lugar inexistente').expect(200);
      expect(await ctx.prisma.placeSearchCache.count()).toBe(0);
    });

    it('limpeza remove só as entradas vencidas', async () => {
      const trip = await createTrip(ctx, owner);
      await search(trip.id, 'Marco Zero').expect(200);
      await search(trip.id, 'Paço do Frevo').expect(200);
      await ctx.prisma.placeSearchCache.updateMany({
        where: { query: 'marco zero' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(await service().purgeExpired()).toBe(1);
      expect((await ctx.prisma.placeSearchCache.findMany()).map((r) => r.query)).toEqual(['paco do frevo']);
    });
  });

  describe('link público', () => {
    it('expõe coordenadas das atividades, exceto hospedagem, e nunca a hospedagem da viagem', async () => {
      const trip = await createTrip(ctx, owner, { plan: 'PRO' });
      await ctx
        .http()
        .patch(api(trip.id))
        .set(owner.auth)
        .send({ stay: 'Hotel Secreto, quarto 12', destinationPlace: RECIFE })
        .expect(200);
      const url = api(`${trip.id}/days/${trip.days[0].id}/activities`);
      await ctx.http().post(url).set(owner.auth).send(activity('Marco Zero', '09:00', { location: 'Marco Zero', ...MARCO_ZERO })).expect(201);
      await ctx
        .http()
        .post(url)
        .set(owner.auth)
        .send(
          activity('Check-in', '14:00', {
            category: 'hospedagem',
            location: 'Pousada',
            latitude: -8.1,
            longitude: -34.9,
            formattedAddress: 'Rua Privada, 10',
            placeId: 'geo-pousada',
            placeProvider: 'geoapify',
          }),
        )
        .expect(201);
      const share = await ctx.http().put(api(`${trip.id}/share`)).set(owner.auth).send({ enabled: true }).expect(200);

      const pub = await ctx.http().get(`/api/v1/public/trips/${share.body.token}`).expect(200);
      expect(pub.body.destinationCenter).toEqual({ latitude: RECIFE.latitude, longitude: RECIFE.longitude });
      const [marco, checkin] = pub.body.days[0].activities;
      expect(marco).toMatchObject({ latitude: MARCO_ZERO.latitude, longitude: MARCO_ZERO.longitude, formattedAddress: MARCO_ZERO.formattedAddress });
      expect(marco).not.toHaveProperty('placeId');
      expect(checkin).toMatchObject({ latitude: null, longitude: null, formattedAddress: null });
      const raw = JSON.stringify(pub.body);
      expect(raw).not.toContain('Hotel Secreto');
      expect(raw).not.toContain('Rua Privada');
      expect(raw).not.toContain('geo-pousada');
    });
  });
});
