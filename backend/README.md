# BoraAli — backend

API do BoraAli: roteiros de viagem com planejamento manual, colaboração, link público, pagamento único por viagem
(Stripe Checkout, BRL) e geração com IA (Claude).

**Stack:** NestJS 11 · TypeScript 5.9 · Prisma 6 · PostgreSQL 17 · Stripe (`stripe` 23, API `2026-09-30.endive`) ·
Anthropic SDK (modelo configurável, padrão `claude-opus-5-5`) · Resend (`resend` 6) · Jest + Supertest.

Monólito modular. A fila de trabalhos (IA) usa o próprio PostgreSQL (`FOR UPDATE SKIP LOCKED`), sem Redis.

---

## Sumário

1. [Como executar](#como-executar)
2. [Scripts e checks](#scripts-e-checks)
3. [Organização](#organização)
4. [Regras de negócio](#regras-de-negócio)
5. [Autenticação e tokens no frontend](#autenticação-e-tokens-no-frontend)
6. [Stripe em modo teste](#stripe-em-modo-teste)
7. [Reembolso e disputa](#reembolso-e-disputa)
8. [IA](#ia)
9. [E-mail (Resend)](#e-mail-resend)
10. [Localização e mapa (Geoapify)](#localização-e-mapa-geoapify)
11. [Integração com o frontend](#integração-com-o-frontend)
12. [Observabilidade e segurança](#observabilidade-e-segurança)
13. [Endpoints](#endpoints)
14. [Pendências de configuração externa](#pendências-de-configuração-externa)

---

## Como executar

Requisitos: Node 24+, Docker.

### Desenvolvimento (API local, banco no Docker)

```bash
cp .env.example .env               # gere um JWT_ACCESS_SECRET (comando no arquivo)
docker compose up -d postgres      # também cria o banco boraali_test
npm install
npx prisma migrate deploy
npm run db:seed                    # usuários e viagens de exemplo
npm run start:dev                  # http://localhost:3333/api/v1 — Swagger em /api/docs
```

Com `RUN_WORKERS=true` (padrão no `.env.example`) a própria API processa a fila de IA e a reconciliação de
pagamentos. Em produção use `RUN_WORKERS=false` na API e rode o worker separado (`npm run start:worker`).

Usuários do seed (senha `boraali123`):

| E-mail | Papel |
| --- | --- |
| `ana@boraali.dev` | Proprietária de "Férias em Lisboa" (PRO_AI) e "Fim de semana em Paraty" (FREE, 5 atividades no 1º dia — no limite do plano) |
| `bruno@boraali.dev` | EDITOR em Lisboa |
| `carla@boraali.dev` | VIEWER em Lisboa |

Link público de exemplo: `GET /api/v1/public/trips/seed-lisboa-link-publico-0001`.

### Tudo em contêineres

```bash
cp .env.example .env
docker compose up --build          # postgres → migrate → api (:3333) + worker
```

Serviços: `postgres`, `migrate` (aplica migrações e encerra), `api` (`RUN_WORKERS=false`) e `worker` (fila de IA +
reconciliação). A imagem é única (`boraali-backend:local`), com comandos diferentes.

---

## Scripts e checks

| Comando | O que faz |
| --- | --- |
| `npm run start:dev` | API com reload |
| `npm run build` / `npm start` / `npm run start:worker` | Build e execução de produção |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (src, test, prisma, scripts) |
| `npm test` | Unitários + e2e (precisa do Postgres do compose) |
| `npm run test:unit` / `npm run test:e2e` | Separadamente |
| `npm run db:seed` | Seed idempotente de desenvolvimento |
| `npm run stripe:setup` | Cria produtos/preços no Stripe **de teste** |
| `npm run ai:eval -- --confirm-paid-calls` | Avaliação opcional de custo da IA (**chamadas pagas**; ver [IA](#ia)) |

Os testes e2e usam o banco `boraali_test` (aplicam as migrações sozinhos) e **nenhum serviço externo**: um gateway
Stripe falso **com verificação de assinatura real do SDK**, um provedor de IA roteirizável e um cliente Resend falso
que deduplica por chave de idempotência. Cobrem: autorização por papel e plano, limite diário sob concorrência
(10 requisições simultâneas → exatamente 3 criadas), lote atômico, conflito de versão, alteração de datas, convites
(envio, falha, reenvio sem duplicar, limites, escape do template, ausência de tokens nos logs), link público,
checkout/upgrade/elegibilidade, compras duplicadas, webhooks repetidos/concorrentes/fora de ordem/com valor
divergente, pagamento assíncrono, reembolso/disputa, reconciliação e IA. Na IA: recusa sem nova tentativa e sem troca
de modelo, novas tentativas só em erros transitórios (backoff/`retry-after`), cota liberada em falhas com custo
preservado, reservas de orçamento concorrentes, limites de tamanho, configuração de modelo/preços e idempotência.

---

## Organização

```
src/
  config/          validação de ambiente (zod) e AppConfig tipado
  common/          erros padronizados, validadores, datas locais, logging
  prisma/          PrismaService (+ bloqueio de linhas em ordem determinística)
  modules/
    auth/          cadastro, login, refresh com rotação, logout, guard JWT global
    users/         /users/me
    entitlements/  ★ regras centrais: plano → recursos, papel → ações, cota e orçamento de IA
    trips/         CRUD de viagens, sincronização de dias ao mudar datas
    itinerary/     dias e atividades: limites, versões, ordenação, lote, avisos
    invitations/   convites e participantes
    sharing/       link público
    mail/          porta de e-mail, adaptador Resend, outbox de desenvolvimento e templates
    billing/       checkout, webhooks, sincronização de pagamentos, reconciliação
    ai/            trabalhos de IA, worker, provedores (Anthropic e mock)
    health/        liveness/readiness
  main.ts          API HTTP
  worker.ts        processo de segundo plano (sem HTTP)
```

Toda checagem de acesso passa por `TripAccessService.require(userId, tripId, ação)`; o mapa papel → ação e
ação → recurso de plano vive em `entitlements/trip-access.service.ts`, e o catálogo de planos/preços em
`entitlements/plan-policy.ts`. Nenhum limite depende do frontend.

---

## Regras de negócio

### Planos (por viagem, sem expiração)

| | FREE | PRO (R$ 9,90) | PRO_AI (R$ 19,90) |
| --- | --- | --- | --- |
| Atividades por dia | 5 | ilimitado | ilimitado |
| Colaboração (convites) | — | ✓ | ✓ |
| Link público | — | ✓ | ✓ |
| IA | — | — | ✓ |

Upgrade PRO → PRO_AI: R$ 10,00. PRO_AI não compra PRO; PRO só compra o upgrade; FREE compra PRO ou PRO_AI. Valores
internos em centavos (990, 1990, 1000). Exportação PNG/PDF é feita no frontend, em todos os planos.

### Papéis

| Ação | OWNER | EDITOR | VIEWER |
| --- | :-: | :-: | :-: |
| Ler viagem, dias, atividades, participantes | ✓ | ✓ | ✓ |
| Criar/editar/mover/excluir/reordenar atividades, títulos de dias | ✓ | ✓ | |
| Solicitar IA (PRO_AI) | ✓ | ✓ | |
| Editar/excluir viagem, convites, papéis, link público, compras | ✓ | | |

Se a viagem voltar ao FREE (reembolso/disputa), convidados mantêm o vínculo mas o acesso fica suspenso
(`TRIP_UPGRADE_REQUIRED`) e o link público deixa de responder. Nada é apagado.

### Datas e horários

- `startDate`, `endDate` e `day.date` são **datas locais** `YYYY-MM-DD` (coluna `DATE`), sem conversão de fuso.
- `activity.time` é `HH:MM` **no fuso da viagem** (`timeZone` IANA); guardado como minutos desde 00:00.
- Timestamps técnicos (`createdAt`, `expiresAt`…) são ISO‑8601 em UTC.

### Atividades

- Ordenação: horário, depois `position` (desempate). `PUT …/activities/order` só altera o desempate e recusa ordens que
  contrariem os horários (`INVALID_REORDER`). Mudar horário ou dia coloca a atividade no fim do novo horário.
- Limite FREE: verificado na criação, no lote (atômico) e ao mover entre dias, com os dias bloqueados
  (`SELECT … FOR UPDATE`) na transação — requisições concorrentes não passam do limite.
- Dia acima do limite (após reversão do plano): consulta, edição e exclusão continuam; novas adições são bloqueadas.
- Sobreposição (com duração definida) gera `warnings` informativos; não impede salvar.
- Controle de versão otimista: `PATCH` exige `version`; `DELETE` aceita `?version=`. Versão desatualizada →
  `409 VERSION_CONFLICT` com a versão atual em `details.current`.

### Alteração de datas da viagem

Dias que continuam são preservados; novos dias são criados; dias vazios fora do período são removidos. Se algum dia
removido tiver atividades, a API responde `409 TRIP_DATE_CHANGE_CONFLICT` com `details.affectedDays`. Para confirmar,
reenvie com `confirmRemoveDates: ["2026-12-20", …]` (as datas listadas). Novas atividades criadas nesse meio-tempo
geram novo conflito.

---

## Autenticação e tokens no frontend

- **Access token**: JWT HS256, 15 min (`ACCESS_TOKEN_TTL_SECONDS`), enviado em `Authorization: Bearer`. A cada
  requisição a sessão é conferida no banco, então logout tem efeito imediato.
- **Refresh token**: aleatório (256 bits), **apenas em cookie** `boraali_rt` — `HttpOnly`, `Path=/api/v1/auth`,
  `SameSite`/`Secure`/`Domain` configuráveis. O banco guarda só o hash (SHA‑256).
- **Rotação**: cada `POST /auth/refresh` emite um novo refresh token e invalida o anterior. Reapresentar um token já
  rotacionado (fora de uma janela de 15 s para corridas entre abas) revoga a sessão inteira.
- Senhas com **argon2id** (parâmetros OWASP). Login não revela se o e-mail existe.

**Estratégia recomendada no frontend (Next.js):**

1. Guarde o access token **somente em memória** (estado/contexto). Nunca em `localStorage`/`sessionStorage`.
2. Todas as chamadas a `/auth/*` com `credentials: 'include'` (o cookie só trafega nesse caminho).
3. Ao carregar a aplicação, chame `POST /auth/refresh` para obter um access token a partir do cookie.
4. Em `401 UNAUTHENTICATED`, faça **um** refresh e repita a requisição. Serialize os refresh (uma promessa
   compartilhada), para que várias requisições simultâneas não disparem refreshes concorrentes.
5. Logout: `POST /auth/logout` (com credenciais) e descarte o token da memória.
6. Frontend e API em sites diferentes em produção: `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none` e a origem do frontend
   em `CORS_ORIGINS`. Mesmo site (ex.: `app.` e `api.` do mesmo domínio): prefira `SameSite=lax` e `COOKIE_DOMAIN`.

Como o refresh só aceita `POST` com JSON e o CORS restringe origens, um site de terceiros não consegue ler a resposta.

---

## Stripe em modo teste

> Não use chaves live. `env.ts` recusa `sk_live_…` (a menos que `STRIPE_ALLOW_LIVE_KEYS=true`), e o script de setup
> só aceita `sk_test_…`.

1. Crie produtos/preços de teste e copie as variáveis exibidas para o `.env`:
   ```bash
   STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup
   ```
   O checkout também confere, antes de cada compra, que o preço configurado no Stripe tem o valor, a moeda (BRL) e o
   tipo (pagamento único) do catálogo interno (`BILLING_MISCONFIGURED` se não tiver).
2. Encaminhe webhooks para a API local com a [Stripe CLI](https://docs.stripe.com/stripe-cli):
   ```bash
   stripe listen --forward-to localhost:3333/api/v1/billing/webhooks/stripe
   ```
   Copie o `whsec_…` exibido para `STRIPE_WEBHOOK_SECRET`.
3. Faça uma compra pelo frontend (ou via Swagger) e pague com o cartão de teste `4242 4242 4242 4242`, validade
   futura, qualquer CVC.

**Eventos usados** (configure-os no endpoint do Dashboard em homologação/produção):
`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`,
`charge.dispute.closed`.

> `stripe trigger …` cria objetos próprios, sem relação com pedidos do BoraAli: esses eventos são registrados como
> `unknown_order` e não alteram nada. Para testar o fluxo de verdade, passe pelo checkout.

### Como o pagamento é confirmado

- O cliente envia só `tripId` e `plan`; o servidor decide produto, preço e elegibilidade e grava um `Order`.
- Um índice único parcial garante **um pedido ativo por viagem** (`CREATED`/`OPEN`/`PROCESSING`). Repetir a compra do
  mesmo produto reaproveita a sessão aberta; trocar de produto expira a sessão anterior no Stripe.
- A sessão é criada com `Idempotency-Key: checkout:<orderId>` e carrega `orderId` em `client_reference_id` e
  `metadata`.
- O benefício é liberado **somente** quando o servidor confirma na API do Stripe que a sessão está `complete` +
  `payment_status=paid`, e que referência, moeda, valor e modo conferem com o pedido. O redirect de sucesso nunca
  libera nada.
- O webhook verifica a assinatura com o corpo bruto, registra o `event.id` (`StripeWebhookEvent`) e sempre consulta o
  estado atual no Stripe. Isso torna o processamento idempotente e independente da ordem dos eventos. Falhas
  respondem 5xx para o Stripe reenviar.
- O plano é recalculado a partir dos pedidos pagos (nunca rebaixa ao conceder). Pagamentos sem efeito ou em
  duplicidade ficam com `requiresReview=true` para reembolso manual.
- **Reconciliação** (worker, a cada 5 min): revisita sessões abertas vencidas, pedidos `PROCESSING` e pedidos `CREATED`
  interrompidos. `GET /billing/orders/:id` também consulta o Stripe (no máximo a cada 15 s) enquanto o pedido estiver
  pendente.

Estados do pedido: `CREATED → OPEN → (PROCESSING) → PAID`, ou `FAILED`/`EXPIRED`/`CANCELED`. Depois de pago, pode ir
para `REFUNDED` ou `DISPUTED` (e voltar a `PAID` se a disputa for ganha).

---

## Reembolso e disputa

Política implementada (revise com o jurídico/financeiro):

| Evento | Efeito |
| --- | --- |
| Reembolso **total** (`charge.refunded` com `refunded=true`) | Pedido `REFUNDED`; plano recalculado sem ele |
| Reembolso parcial | Nenhuma mudança de plano (tratar caso a caso) |
| Disputa aberta (`needs_response`, `under_review`, `lost`) | Pedido `DISPUTED`; benefício suspenso |
| Disputa ganha (`won`) | Pedido volta a `PAID`; benefício restaurado |
| Consultas (`warning_*`) | Sem efeito |

Reembolsar o PRO de uma viagem que fez upgrade derruba também o upgrade, que sozinho não concede PRO_AI.

**O roteiro nunca é apagado.** Ao voltar ao FREE: dias com mais de 5 atividades continuam consultáveis, editáveis e
excluíveis, mas não aceitam novas atividades; convidados ficam com acesso suspenso; o link público para de responder;
a IA fica indisponível. Se o pagamento for restaurado, tudo volta a funcionar sem reconfiguração.

Reembolsos são feitos pelo Dashboard do Stripe; o webhook aplica o efeito. Pedidos com `requiresReview=true`
(pagamento sem efeito ou duplicado) devem ser reembolsados manualmente — o worker registra um aviso enquanto houver
algum.

---

## IA

- Provedor: **Claude** via SDK oficial (`@anthropic-ai/sdk`, Messages API), saída estruturada (schema Zod via
  `messages.parse`) e timeout por chamada (`AI_TIMEOUT_MS`). Modelo em `AI_MODEL` (padrão `claude-opus-5-5`),
  validado na inicialização: precisa existir no catálogo de preços. `effort` (`AI_EFFORT`) só é enviado a modelos que
  o aceitam (o Haiku 4.5 não aceita).
- **Sem fallback entre modelos.** Uma recusa do modelo (`stop_reason: "refusal"`) encerra o trabalho com
  `AI_REQUEST_REFUSED` e uma mensagem pronta para o usuário. Recusas não são repetidas nem enviadas a outro modelo, e a
  cota funcional é liberada.
- **Novas tentativas só para erros transitórios**: rede/timeout, `429` com `retry-after`, `5xx`/`529`. São no máximo
  `AI_MAX_RETRIES` (padrão 2), com backoff exponencial com jitter (`AI_RETRY_BASE_DELAY_MS`) e respeitando
  `retry-after`. Se a espera passar de `AI_MAX_RETRY_WAIT_MS`, não há nova tentativa. O SDK roda com `maxRetries: 0`,
  e quem controla as tentativas é o worker. Não são repetidos: `429` de limite de gasto (sem `retry-after`), `400`,
  `401/403`, saída truncada (`AI_OUTPUT_TRUNCATED`) e saída fora do schema (`AI_INVALID_OUTPUT`).
- `AI_PROVIDER=mock` só é aceito em development/test. Sem `ANTHROPIC_API_KEY`, a IA aparece como indisponível
  (`available=false`, `PROVIDER_NOT_CONFIGURED`) e as solicitações respondem `503 AI_UNAVAILABLE`.

### Fluxo

1. `GET /trips/:id/ai/usage` → `enabled`, `available`, `unavailableReason`, `canRequest` e uso por tipo (`limit`,
   `used`, `reserved`, `remaining`).
2. `POST /trips/:id/ai/day-suggestions | trip-suggestions | adjustments` com `Idempotency-Key` → `202` + trabalho
   `QUEUED` (header `Location`). A reserva é atômica: a viagem é bloqueada; cota, orçamento e trabalho ativo são
   conferidos; e o trabalho é gravado na mesma transação. Há no máximo **um trabalho ativo por viagem**
   (`409 AI_JOB_IN_PROGRESS`). A mesma chave devolve o mesmo trabalho (`200`).
3. Faça polling em `GET /trips/:id/ai/jobs/:jobId` (a cada 1–2 s) até `SUCCEEDED` ou `FAILED`.
4. `SUCCEEDED` consome **uma** utilização, não importa quantas chamadas ou tentativas houve. `FAILED` libera a
   utilização; `error.code`/`error.message` dizem o motivo (`AI_REQUEST_REFUSED`, `AI_BUDGET_EXHAUSTED`,
   `AI_TIMEOUT`…).

**Nada é aplicado automaticamente.** O resultado traz `suggestions` (dia + atividade) ou `changes`
(`add`/`update`/`remove` com `activityId` e `baseVersion`). O frontend aplica o que o usuário aceitar pelos endpoints
normais — `POST …/activities/batch` para adicionar e `PATCH`/`DELETE` com `version = baseVersion` — e assim respeita
limites e conflitos.

**Verificação:** sem ferramenta de busca, todo item vem com `verification.status = "UNVERIFIED"` e `sources: []`,
imposto pelo servidor independentemente do que o modelo responder. A saída é revalidada: datas fora do escopo,
horários inválidos, categorias desconhecidas, IDs inexistentes e itens acima dos limites são descartados
(`discarded`).

### Limites por pedido

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `AI_MAX_PROMPT_CHARS` | 500 | Tamanho do pedido/instrução → `422 AI_REQUEST_TOO_LARGE` |
| `AI_MAX_DAYS_PER_GENERATION` | 7 | Dias por geração completa ou ajuste (use `dayIds`) → `422 AI_TOO_MANY_DAYS` |
| `AI_DAYS_PER_CALL` | 3 | Dias por chamada ao modelo (viagem de 7 dias = 3 chamadas) |
| `AI_MAX_CONTEXT_ACTIVITIES_PER_DAY` | 25 | Atividades por dia enviadas como contexto |
| `AI_MAX_SUGGESTIONS_PER_DAY` | 5 | Sugestões devolvidas por dia |
| `AI_MAX_ADJUST_CHANGES` | 10 | Mudanças devolvidas por ajuste |
| `AI_MAX_OUTPUT_TOKENS` | 8000 | `max_tokens` por chamada (inclui o pensamento adaptativo) |

### Custo e orçamento interno

- **Registro por tentativa** (`AiAttempt`): provedor, modelo pedido e modelo efetivamente usado (da resposta), tokens
  de entrada/saída, escrita/leitura de cache (quando informadas), duração, status, `request-id` do provedor,
  categoria da recusa, reserva e custo.
- **Custo estimado** = tokens × preço do catálogo do **modelo efetivo**, em micro-unidades de `AI_PRICING_CURRENCY`,
  com `pricingReferenceDate`. Sem dados de uso (timeout, erro de rede/HTTP) ou com modelo sem preço, o custo fica
  `UNKNOWN` — nunca zero.
- **Catálogo padrão** (preços oficiais conferidos em 2026-10-07, USD/MTok): Opus 5.5 4/20 (cache 5/0,20),
  Sonnet 5.5 2/10 (2,50/0,20), Haiku 4.5 1/5 (1,25/0,10). Para outro modelo ou preços novos, use `AI_PRICING_JSON`
  (que exige `AI_PRICING_REFERENCE_DATE`).
- **Orçamento interno por viagem** (`AI_TRIP_BUDGET`, padrão 1,50 USD) é separado das cotas funcionais e nunca é
  exibido. O usuário vê apenas `available=false` / `unavailableReason=AI_BUDGET_EXHAUSTED` ou recebe
  `403 AI_BUDGET_EXHAUSTED`.
- **Reserva conservadora antes de cada chamada**: entrada estimada (2 caracteres/token + 1.500 tokens de folga) +
  `AI_MAX_OUTPUT_TOKENS`, sem descontos de cache. A conferência e a gravação acontecem com a viagem bloqueada
  (`FOR UPDATE`), então reservas concorrentes não ultrapassam o orçamento.
- **Reconciliação após a resposta**: a reserva vira o custo estimado. Gasto da viagem = Σ custos estimados +
  Σ reservas de chamadas em andamento ou com custo desconhecido. Uma tentativa que falhou continua contando: falha não
  significa custo zero.
- **Recusas**: segundo a documentação da Anthropic (set/2026), recusas antes de qualquer saída só são cobradas nas
  categorias `bio`, `frontier_llm` e `reasoning_extraction`. O BoraAli registra o custo pelo uso informado em qualquer
  categoria, de forma conservadora.

### Cotas iniciais e premissas

Cotas iniciais **conservadoras** (antes 30/3/15): `AI_LIMIT_DAY_SUGGESTIONS=10`, `AI_LIMIT_TRIP_SUGGESTIONS=1`,
`AI_LIMIT_ADJUST_ITINERARY=5`.

Premissas **não medidas** (estimativas para dimensionar; confirme com `npm run ai:eval`):

| Operação | Chamadas | Entrada/saída por chamada (tokens) | Opus 5.5 | Sonnet 5.5 |
| --- | --- | --- | --- | --- |
| Sugestão de dia | 1 | ~2.500 / ~3.000 (texto + pensamento) | ~0,07 USD | ~0,035 USD |
| Viagem de 7 dias | 3 | ~3.000 / ~5.000 | ~0,34 USD | ~0,17 USD |
| Ajuste | 1 | ~3.500 / ~3.000 | ~0,07 USD | ~0,04 USD |
| **Todas as cotas** (10 + 1 + 5) | 16 | — | **~1,41 USD** | **~0,70 USD** |

Leitura: o PRO_AI custa R$ 10,00 a mais que o PRO. Com câmbio hipotético de R$ 5,50/USD, o orçamento de 1,50 USD
(~R$ 8,25) cobre o uso total estimado com Opus. Mas um cliente que esgote as cotas pode consumir quase todo o valor
incremental, antes das taxas do Stripe e dos impostos. **Nenhuma rentabilidade é afirmada.** Meça antes de ajustar
modelo, `AI_EFFORT`, cotas ou orçamento. A reserva de pior caso por chamada é ~0,17 USD (Opus, 8.000 tokens de saída).
Até 3 tentativas com custo desconhecido podem reservar ~0,52 USD de uma vez.

### Avaliação opcional (chamadas pagas)

```bash
npm run ai:eval -- --confirm-paid-calls [--model claude-sonnet-5-5] [--out ai-eval.json]
```

Mede uma sugestão de dia, uma viagem curta (3 dias) e um ajuste. Registra tokens, cache, duração, status, custo
estimado e reserva, e projeta o custo de uma viagem que use todas as cotas. Exige a flag explícita e
`ANTHROPIC_API_KEY`, e recusa rodar em CI/testes. Nunca é executado por `npm test` nem pelo build. Com os padrões,
faz 5 chamadas (amostra única: repita algumas vezes antes de decidir).

---

## E-mail (Resend)

- `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` (domínio verificado no Resend) ativam o envio real
  (`resend.emails.send(payload, { idempotencyKey })`). Sem chave ou remetente, nada é enviado: convites respondem
  `503 EMAIL_DELIVERY_UNAVAILABLE`, sem criar o convite.
- `EMAIL_PROVIDER=dev` guarda os e-mails em memória (`GET /api/v1/dev/outbox`). É recusado em produção pela validação
  de ambiente, e o endpoint responde 404 em produção.
- **Template de convite** em português, com HTML e versão texto: nome da viagem, destino, remetente, papel,
  validade (horário de Brasília) e botão "Aceitar convite" para `${FRONTEND_URL}/convites/<token>`. Todo conteúdo
  vindo de usuários é escapado no HTML; o assunto não aceita quebras de linha.
- **Token**: o banco guarda só o hash e um nonce. O token é `HMAC(chave derivada de JWT_ACCESS_SECRET, id + nonce)`,
  o que permite reenviar o **mesmo link** sem armazenar o token. Trocar `JWT_ACCESS_SECRET` invalida links de
  convites pendentes. Tokens, links e conteúdo de e-mail nunca são logados. Erros registram só o código e o status
  do provedor.
- **Estados da entrega** (`delivery.status`), separados do estado do convite (`status`):
  `PENDING` (envio pendente/em andamento) → `PROVIDER_ACCEPTED` (aceito pelo Resend — **não** garante entrega na caixa
  do destinatário) ou `FAILED` (o convite continua válido e pode ser reenviado).
- **Idempotência**: cada envio usa `invitation/<id>/send-<n>`. Novas tentativas automáticas (até 2, para
  `rate_limit_exceeded`, `application_error`, `internal_server_error`, `concurrent_idempotent_requests` e falhas de
  rede, respeitando `retry-after`) reaproveitam a chave. Assim, um envio que chegou a ser aceito nunca é duplicado.
- **Reenvio** (`POST /trips/:tripId/invitations/:id/resend`): só convites pendentes (nem aceitos, nem revogados, nem
  expirados). Respeita `INVITATION_RESEND_MIN_INTERVAL_SECONDS` (`429 INVITATION_RESEND_LIMITED` com
  `retryAfterSeconds`) e `INVITATION_MAX_SENDS` (`403 INVITATION_RESEND_LIMITED`).
  - Após uma falha transitória, o reenvio usa a **mesma chave**: sem duplicar, e sem contar como novo envio.
  - Após o aceite pelo provedor ou uma falha definitiva, abre um novo envio (`send-<n+1>`).
  - Cliques simultâneos geram um único envio (`409 INVITATION_DELIVERY_IN_PROGRESS`).

---

## Localização e mapa (Geoapify)

Atividades e o destino da viagem podem ter um **lugar real**, escolhido pela pessoa entre as sugestões do
[Address Autocomplete da Geoapify](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/). O mapa do
frontend (MapLibre GL JS) usa tiles do [OpenFreeMap](https://openfreemap.org), sem chave e sem créditos (veja
`frontend/README.md`); a Geoapify é usada só na busca.

### Dados

| Onde | Campos | Regras |
| --- | --- | --- |
| `Activity` | `location` (texto), `formattedAddress`, `latitude`, `longitude`, `placeId`, `placeProvider` | Coordenadas só em par e dentro dos limites; `placeId` exige `placeProvider` e coordenadas; sem coordenadas o endereço formatado é descartado. Também garantido por `CHECK` no banco. |
| `Trip` | `destinationLatitude/Longitude`, `destinationFormattedAddress`, `destinationPlaceId`, `destinationPlaceProvider` (API: `destinationPlace`) | Mesmas regras. Mudar o texto de `destination` sem enviar `destinationPlace` limpa a localização anterior. |

- O lugar é uma **unidade**: um `PATCH` que envia qualquer campo do lugar substitui todos (os ausentes ficam `null`),
  e latitude/longitude precisam vir juntas — inclusive para limpar (`null, null`).
- Mudar o texto de `location` sem enviar campos do lugar **limpa** coordenadas e identificação antigas.
- Texto livre continua válido: atividade sem coordenadas aparece na lista e não no mapa.
- Nenhuma geocodificação é feita automaticamente (nem na leitura nem ao trocar de dia); o servidor nunca escolhe
  sozinho o primeiro resultado de uma busca.

### Busca: `GET /trips/:tripId/places/search?q=&kind=place|destination&limit=`

- `kind=place` (padrão) exige `OWNER`/`EDITOR`; `kind=destination` exige `OWNER`. Sem vínculo → `404`.
- `q` com 2–200 caracteres (o frontend só busca a partir de 3, com debounce de 350 ms e cancelamento).
- Com o destino confirmado, a busca usa `bias=proximity` (orienta sem filtrar: passeios em cidades vizinhas
  continuam aparecendo). Resultados em `pt`, até 8, deduplicados por `placeId`.
- Resposta: `{ results: [{ provider, placeId, name, formattedAddress, secondary, city, state, country, countryCode,
  latitude, longitude, resultType }], attribution, biasedToDestination }`.
- Erros: `503 LOCATION_SEARCH_UNAVAILABLE` (sem chave ou `GEOCODING_PROVIDER=none`), `502 LOCATION_PROVIDER_ERROR`
  (`details.reason`: `timeout`, `rate_limited`, `unauthorized`, `provider`), `429 RATE_LIMITED`.
- Proteções: timeout (`GEOCODING_TIMEOUT_MS`), limite por IP na rota (60/min), limite por usuário de consultas ao
  provedor (`GEOCODING_USER_LIMIT_PER_MINUTE`, por processo; acertos de cache não contam) e deduplicação de consultas
  simultâneas iguais.

### Cache de buscas (economia de créditos)

Cada consulta paga é guardada e reaproveitada por todos os usuários, em duas camadas:

1. **Memória do processo** (`GEOCODING_CACHE_TTL_SECONDS`, `GEOCODING_CACHE_MAX_ENTRIES`).
2. **Banco** — tabela `PlaceSearchCache` (`GEOCODING_DB_CACHE_TTL_DAYS`, padrão 90 dias): sobrevive a deploys e é
   compartilhada entre instâncias. Falhas do banco não quebram a busca (segue para o provedor).

- O cache guarda a **resposta exata** do provedor para a consulta — nunca uma busca aproximada nos lugares salvos, que
  poderia esconder a opção certa (ex.: devolver só o Marco Zero de São Paulo para quem procura o de Recife).
- Chave: `provedor|tipo|idioma|região|texto`, com o texto sem acentos, minúsculo e com espaços simples. A região do
  viés é arredondada a 0,1° (~11 km) — e o provedor recebe esse mesmo ponto —, então viagens para a mesma cidade
  compartilham o cache. O provedor é sempre consultado com o máximo de resultados (8) e a resposta é recortada pelo
  `limit` pedido, que não divide o cache.
- Não guarda quem buscou (sem usuário nem viagem). Respostas vazias ficam só na memória, para um lugar recém-mapeado
  não ficar escondido por meses.
- `hits`/`lastHitAt` mostram o reaproveitamento; o worker apaga diariamente as entradas vencidas (04:00).
  Para medir: `SELECT count(*), sum(hits) FROM "PlaceSearchCache";` — cada hit é um crédito economizado.
- No frontend, o campo "Local" mostra antes os **lugares já usados na viagem** ("Nesta viagem"), sem chamar a API.
- A chave (`GEOAPIFY_API_KEY`) existe só no backend e não é registrada em log.

### Link público

`GET /public/trips/:token` expõe `destinationCenter` e, por atividade, `formattedAddress`, `latitude` e `longitude` —
**exceto em atividades de hospedagem**, que ficam sem ponto e sem endereço (onde o grupo dorme não é público). A
hospedagem da viagem (`stay`) e os identificadores do provedor nunca são expostos.

### Configuração, custos e termos (conferidos em 2026-10-07 — revise no painel antes de produção)

1. Crie um projeto em [myprojects.geoapify.com](https://myprojects.geoapify.com/) e gere uma chave para o backend
   (`GEOAPIFY_API_KEY`, nunca no navegador). Se o backend tiver IP de saída fixo, restrinja a chave por IP em
   *API Keys → proteção da chave*. O frontend não usa chave da Geoapify (os tiles vêm do OpenFreeMap).
2. **Custos/limites** ([preços](https://www.geoapify.com/pricing/), [detalhes](https://www.geoapify.com/pricing-details/)):
   plano gratuito com 3.000 créditos/dia e até 5 requisições/s; 1 busca de autocomplete = 1 crédito. Cada digitação que passa do debounce e não está em cache consome um crédito.
   Confira no painel o consumo diário e o comportamento ao atingir o limite (o backend responde
   `502 LOCATION_PROVIDER_ERROR` com `reason=rate_limited`).
3. **Atribuição** ([termos](https://www.geoapify.com/terms-and-conditions/)): "© OpenStreetMap contributors" sempre e
   "Powered by Geoapify" no plano gratuito — as sugestões exibem o texto de `attribution` da resposta. O mapa exibe as
   atribuições do estilo do OpenFreeMap (© OpenMapTiles, © OpenStreetMap).
4. **Armazenamento**: a documentação da Geoapify permite guardar e armazenar em cache os resultados de geocodificação
   sem prazo, mantendo a atribuição (dados derivados do OpenStreetMap, licença ODbL). Por isso gravamos
   coordenadas/endereço/`placeId` e usamos cache. Revise os termos vigentes antes de produção.

Sem `GEOAPIFY_API_KEY`, a busca responde `503` e o formulário avisa que o local será salvo só como texto.

## Integração com o frontend

- Base: `http://localhost:3333/api/v1`. Swagger: `/api/docs` (JSON em `/api/docs/openapi.json`, bom para gerar o
  cliente tipado).
- **Erros** sempre no formato `{ code, message, details?, requestId }`. Decida pelo `code`:

  | code | Quando | Sugestão de UI |
  | --- | --- | --- |
  | `DAILY_ACTIVITY_LIMIT_REACHED` | 4ª atividade no FREE (`details.limit`, `availableUpgrades`) | Oferecer upgrade |
  | `TRIP_UPGRADE_REQUIRED` | Recurso fora do plano (`details.feature`) | Oferecer upgrade (só OWNER compra) |
  | `VERSION_CONFLICT` | Outro colaborador alterou (`details.current`) | Mostrar versão atual e reaplicar |
  | `TRIP_DATE_CHANGE_CONFLICT` | Datas removem dias com atividades | Confirmar com `confirmRemoveDates` |
  | `AI_USAGE_LIMIT_REACHED` | Cota da operação esgotada na viagem (`details.limit/used`) | Desabilitar o botão daquela operação |
  | `AI_BUDGET_EXHAUSTED` | Uso de IA da viagem chegou ao limite interno (sem valores) | "O uso de IA desta viagem chegou ao limite" |
  | `AI_REQUEST_TOO_LARGE` / `AI_TOO_MANY_DAYS` | Pedido longo demais / dias demais (`details.maxChars`, `maxDays`) | Ajustar o formulário |
  | `AI_JOB_IN_PROGRESS` / `AI_UNAVAILABLE` | Já há geração em andamento / IA indisponível | Acompanhar o trabalho / ocultar IA |
  | `job.error.code = AI_REQUEST_REFUSED` | A IA recusou o pedido (no trabalho, não no HTTP) | Exibir `error.message`; sugerir reformular |
  | `INVITATION_RESEND_LIMITED` / `INVITATION_NOT_RESENDABLE` | Reenvio cedo demais (`retryAfterSeconds`), envios esgotados ou convite não pendente | Desabilitar "reenviar" |
  | `EMAIL_DELIVERY_UNAVAILABLE` | Ambiente sem provedor de e-mail | Ocultar convites |
  | `PAYMENT_PENDING` / `PLAN_ALREADY_ACTIVE` / `PLAN_NOT_ELIGIBLE` | Checkout | Mostrar estado do pedido |
  | `VALIDATION_ERROR` | `details.fields[]` por campo | Erros no formulário |
  | `UNAUTHENTICATED` | Token expirado | Refresh e repetir |

- `GET /trips/:id/entitlements` é a fonte para habilitar/desabilitar recursos (plano, `maxActivitiesPerDay` — `null` =
  ilimitado —, colaboração, compartilhamento, IA com uso, `canPurchase`, `availableUpgrades`). Cada dia também traz
  `canAddActivities`.
- **Checkout:** `POST /billing/checkout {tripId, plan}` → redirecione para `checkoutUrl`. O Stripe volta para
  `${FRONTEND_URL}/app/viagens/:tripId/pagamento?pedido=<orderId>`; nessa página faça polling em
  `GET /billing/orders/:orderId` até `PAID` (recarregue os entitlements) ou `FAILED`/`EXPIRED`/`CANCELED`.
  `PROCESSING` = pagamento assíncrono em análise (pode levar dias). Cancelamento volta para
  `/app/viagens/:tripId?pagamento=cancelado`.
- **Convites:** o e-mail leva para `${FRONTEND_URL}/convites/<token>`. Nessa página use `POST /invitations/preview
  {token}` (público) e, com o usuário logado, `POST /invitations/accept {token}`. Na lista de convites, mostre
  `delivery.status`: `PROVIDER_ACCEPTED` = "enviado" (não "entregue"); `FAILED` = oferecer "reenviar"
  (`POST …/invitations/:id/resend`). Em desenvolvimento, os e-mails ficam em `GET /api/v1/dev/outbox`.
- **Link público:** `GET /trips/:id/share` devolve `token` e `url` (`${FRONTEND_URL}/r/<token>`); a página pública lê
  `GET /public/trips/<token>`.
- Categorias: `passeio`, `alimentacao`, `transporte`, `descanso`, `hospedagem`, `outros` (o protótipo ainda não tem
  `outros`).

---

## Observabilidade e segurança

- Logs no **padrão do Nest** (`ConsoleLogger`): `[Nest] PID - data     LOG [Contexto] mensagem`, coloridos (`LOG` em
  verde, `WARN` amarelo, `ERROR` vermelho). Cada requisição gera uma linha no contexto `HTTP`:
  `POST /api/v1/auth/login 200 - 86ms (requestId=…)`. Campos aparecem como `mensagem (chave=valor, …)`.
  `LOG_LEVEL` (`verbose|debug|log|warn|error|fatal|silent`, padrão `log`) e `LOG_FORMAT` (`pretty` padrão, ou `json`
  para uma linha JSON por evento em agregadores de log).
- O `X-Request-Id` recebido é propagado (ou gerado) e devolvido no header e em todo erro. Corpo, headers e cookies
  nunca são logados; tokens em URL (link público) são redigidos.
- `GET /api/v1/health/live` e `GET /api/v1/health/ready` (checa o banco). O compose usa o readiness.
- Ambiente validado com zod na inicialização (`src/config/env.ts`): falha rápido e com mensagem clara.
- Rate limiting por IP (padrão 120/min; login 10/min, cadastro 5/min, refresh 30/min, checkout 10/min,
  convites 20/h, reenvio de convite 10/h, link público 60/min, IA 5–10/min). Atrás de proxy, configure `TRUST_PROXY`.
- Helmet, CORS por ambiente (`CORS_ORIGINS`), `whitelist`/`forbidNonWhitelisted` na validação.

---

## Endpoints

Todos sob `/api/v1`. 🔓 = público.

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/health/live`, `/health/ready` 🔓 | Healthchecks |
| POST | `/auth/register` 🔓, `/auth/login` 🔓 | Cadastro / login (cookie de refresh) |
| POST | `/auth/refresh` 🔓, `/auth/logout` 🔓 | Rotação / revogação (via cookie) |
| GET | `/auth/me` | Usuário atual |
| GET, PATCH | `/users/me` | Perfil |
| POST, GET | `/trips` | Criar / listar (`?scope=all\|owned\|shared`) |
| GET, PATCH, DELETE | `/trips/:tripId` | Detalhe com dias / editar (OWNER) / excluir (OWNER) |
| GET | `/trips/:tripId/entitlements` | Plano, limites, recursos, uso de IA, upgrades |
| GET | `/trips/:tripId/days` | Dias com atividades e avisos |
| GET, PATCH | `/trips/:tripId/days/:dayId` | Dia / título do dia |
| POST | `/trips/:tripId/days/:dayId/activities` | Criar atividade |
| PUT | `/trips/:tripId/days/:dayId/activities/order` | Reordenar desempate |
| POST | `/trips/:tripId/activities/batch` | Adição em lote atômica |
| GET, PATCH, DELETE | `/trips/:tripId/activities/:activityId` | Ler / editar ou mover / excluir |
| GET | `/trips/:tripId/members` | Participantes |
| PATCH, DELETE | `/trips/:tripId/members/:userId` | Alterar papel / remover ou sair |
| POST, GET | `/trips/:tripId/invitations` | Convidar / pendentes |
| POST | `/trips/:tripId/invitations/:invitationId/resend` | Reenviar o mesmo convite |
| DELETE | `/trips/:tripId/invitations/:invitationId` | Revogar convite |
| POST | `/invitations/preview` 🔓, `/invitations/accept` | Tela de aceite / aceitar |
| GET | `/trips/:tripId/places/search` | Busca de lugares para atividades (`kind=place`) ou destino (`kind=destination`) |
| GET, PUT | `/trips/:tripId/share` | Configuração do link público |
| POST | `/trips/:tripId/share/rotate` | Renovar token |
| GET | `/public/trips/:token` 🔓 | Roteiro público somente leitura |
| POST | `/billing/checkout` | Iniciar Stripe Checkout |
| GET | `/billing/orders/:orderId` | Status do pedido |
| GET | `/trips/:tripId/orders` | Pedidos da viagem (OWNER) |
| POST | `/billing/webhooks/stripe` 🔓 | Webhook (assinatura verificada) |
| GET | `/trips/:tripId/ai/usage` | Disponibilidade e consumo de IA |
| POST | `/trips/:tripId/ai/day-suggestions` | Sugestões para um dia |
| POST | `/trips/:tripId/ai/trip-suggestions` | Sugestões para a viagem inteira |
| POST | `/trips/:tripId/ai/adjustments` | Ajustes no roteiro |
| GET | `/trips/:tripId/ai/jobs`, `/trips/:tripId/ai/jobs/:jobId` | Trabalhos de IA |

---

## Pendências de configuração externa

- [ ] **Stripe:** conta (modo teste), `STRIPE_SECRET_KEY`, preços via `npm run stripe:setup`, endpoint de webhook com os
      eventos listados e `STRIPE_WEBHOOK_SECRET`. Para produção: ativar a conta, BRL e os métodos de pagamento
      desejados (ex.: Pix/boleto são assíncronos e já são tratados).
- [ ] **Anthropic:** `ANTHROPIC_API_KEY` e `AI_PROVIDER=anthropic`; escolher `AI_MODEL`/`AI_EFFORT`; rodar
      `npm run ai:eval -- --confirm-paid-calls` algumas vezes e revisar cotas e `AI_TRIP_BUDGET` com os números
      medidos; configurar um limite de gasto na organização (Console → Billing) como proteção adicional.
- [ ] **Resend:** verificar o domínio do remetente (SPF/DKIM), criar uma chave de API com permissão de envio e
      definir `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` e `EMAIL_FROM`. Para validar sem afetar destinatários reais,
      use os endereços de teste do Resend (ex.: `delivered@resend.dev`). Webhooks de entrega (entregue, bounce) não
      estão integrados: hoje o estado final é "aceito pelo provedor".
- [ ] **Produção:** `JWT_ACCESS_SECRET` forte, `CORS_ORIGINS`/`FRONTEND_URL` reais, política de cookies, `TRUST_PROXY`,
      `RUN_WORKERS=false` na API com pelo menos um worker. Com várias réplicas da API, trocar o storage do rate limiting
      por um compartilhado (ex.: Redis).
- [ ] **Geoapify (busca de locais):** criar o projeto e a chave do backend (`GEOAPIFY_API_KEY`), conferir
      créditos/limites do plano e as atribuições. Ver
      [Localização e mapa](#localização-e-mapa-geoapify).
- [ ] **Frontend:** páginas `/app/viagens/:id/pagamento`, `/convites/:token` e `/r/:token`, e a categoria `outros`.
