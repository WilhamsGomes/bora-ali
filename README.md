# BoraAli — frontend

Interface do BoraAli: roteiros de viagem dia a dia, colaboração, link público e sugestões com IA. Consome a API do
diretório `backend/` (NestJS). Os únicos dados ilustrativos estão na landing page e aparecem marcados como exemplo.

> **v1 (validação, branch `v1-sem-planos`):** sem planos nem compra. Todas as viagens têm colaboração, link público e
> IA, e cada dia aceita até 10 atividades. Telas e componentes de pagamento foram removidos.

**Stack:** Next.js 16 (App Router, Cache Components) · React 19 · TypeScript · Tailwind CSS 4 · TanStack Query 5 ·
lucide-react · html-to-image (PNG).

## Como executar

Pré-requisito: a API rodando (veja `backend/README.md`; por padrão em `http://localhost:3333/api/v1`, com
`CORS_ORIGINS` e `FRONTEND_URL` apontando para `http://localhost:3000`).

```bash
cp .env.example .env.local   # ajuste NEXT_PUBLIC_API_URL se necessário
npm install
npm run dev                  # http://localhost:3000
```

Produção: `npm run build && npm start`. Checks: `npx tsc --noEmit`, `npm run lint`, `npm run build`.

### Variáveis de ambiente

| Variável | Exemplo | Uso |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3333/api/v1` | URL base da API (inclui `/api/v1`). É pública e vai para o navegador. |
| `NEXT_PUBLIC_MAP_STYLE_URL` | — (OpenFreeMap) | Estilo MapLibre do mapa. Vazio usa `https://tiles.openfreemap.org/styles/positron`; `off` desativa o mapa. |

Nenhuma chave de Anthropic ou Resend existe no frontend: IA e e-mail acontecem só no backend.
A busca de locais (autocomplete) passa pelo backend; o navegador não usa nenhuma chave de mapa.

### Mapa do dia

- **MapLibre GL JS 6** renderizado só no cliente (`next/dynamic` com `ssr: false`, em `components/map/`). O worker do
  MapLibre é copiado para `public/vendor/` por `scripts/copy-maplibre-worker.mjs` (roda em `predev`/`prebuild`).
- Tiles: [OpenFreeMap](https://openfreemap.org) (estilo `positron`), vetoriais do OpenStreetMap, sem chave, sem cadastro e
  sem limite de visualizações (uso comercial permitido). Não há SLA — o projeto é mantido por doações; se o serviço
  falhar, o painel mostra o erro com "Tentar novamente" e a lista continua. Para trocar (ex.: tiles próprios em
  PMTiles), defina `NEXT_PUBLIC_MAP_STYLE_URL`. Atribuições (© OpenMapTiles, © OpenStreetMap) vêm no estilo.
- Campo "Local": a seção "Nesta viagem" sugere os lugares já escolhidos em outras atividades (sem chamar a API); a
  busca externa passa pelo backend, que guarda as respostas em cache no banco (ver `backend/README.md`).
- Marcadores numerados pela ordem das atividades do dia (a numeração conta também as que não têm local, para bater com
  a lista); atividades no mesmo ponto viram um marcador com todos os itens no balão (título, horário, endereço,
  "Abrir no Google Maps", "Ver na lista").
- Enquadra todos os pontos ao trocar de dia; um ponto usa zoom de rua; sem pontos, centraliza no destino confirmado.
  Mudanças no mesmo dia só reenquadram se a pessoa não moveu o mapa; "Ver todos os locais" reenquadra a pedido.
- Não há rotas nem distâncias: nenhuma linha liga os pontos (roteamento fica para outra etapa).
- O mapa só é montado quando o painel fica visível (aba "Mapa" no celular, painel aberto no desktop) e acompanha o
  tamanho do contêiner (abrir painel, "Ampliar", rotação).
- O exemplo da landing page continua com o mapa ilustrativo em SVG (`components/landing/illustrative-map.tsx`),
  identificado como exemplo; o app nunca o usa.

## Rotas

| Rota | Tela | Acesso |
| --- | --- | --- |
| `/` | Landing page (exemplos ilustrativos) | Público |
| `/entrar`, `/cadastro` | Login e cadastro (aceitam `?next=` para voltar ao destino) | Público |
| `/app` | Minhas viagens (próprias e compartilhadas) | Sessão |
| `/app/viagens/[id]` | Editor do roteiro (respeita o papel: proprietário, editor, leitor) | Sessão |
| `/convites/[token]` | Prévia e aceite de convite | Público (aceite pede login) |
| `/r/[token]` | Roteiro público somente leitura | Público |

## Organização

```
src/
  api/          cliente HTTP único, contratos da API, endpoints e conversão para os tipos das telas
  state/        provedores (TanStack Query + sessão) e hooks de consulta/invalidação
  lib/          regras puras: ordem e sobreposição, modo "Durante a viagem", fusos, limites, datas
  components/   ui/, landing/, auth/, app/, editor/, trip/, map/, location/
  data/         fotos (Unsplash) e roteiros de exemplo da landing
```

- **`api/client.ts`** centraliza URL base, cabeçalhos, formato de erro (`{ code, message, details, requestId }` →
  `ApiError`) e falhas de rede (`NetworkError`). As telas decidem pelo `code`, nunca pela mensagem.
- **`api/endpoints.ts`** tem um método por endpoint real de `/api/v1` (ver `/api/docs`). Nenhum endpoint é inventado.
- **`state/queries.ts`** define as chaves de cache e `invalidateTrip`/`invalidatePlan`, chamadas após cada alteração.

## Sessão

Segue a estratégia do backend:

- O access token fica **só em memória**. O refresh token fica em cookie `httpOnly` da API (`credentials: "include"`
  apenas em `/auth/*`). Nada de sessão vai para `localStorage` ou `sessionStorage`.
- A sessão é restaurada com `POST /auth/refresh` ao abrir a área privada, o login ou um convite. A landing e o link
  público não tocam na sessão.
- Em `401 UNAUTHENTICATED` há **uma** renovação compartilhada por todas as requisições simultâneas, seguida de uma
  única repetição, sem laços. Se a renovação devolver 401, a sessão acaba e o login abre com o destino preservado.
  Já 429 ou 5xx são tratados como falha transitória e mostram "Tentar novamente", sem deslogar.
- No logout, e quando a sessão expira, o cache de consultas é limpo (o polling também para).

## Regras respeitadas

- Datas (`YYYY-MM-DD`) e horários (`HH:MM`) passam sem conversão; os horários são sempre do fuso da viagem, que é
  escolhido de forma explícita ao criar ou editar.
- A ordem vem do backend: horário e depois posição. Reordenar só troca atividades do mesmo horário
  (`PUT …/activities/order`).
- Edição e exclusão enviam `version`. Em `VERSION_CONFLICT` o formulário mantém o rascunho, mostra a diferença para a
  versão atual e deixa a pessoa escolher. Nada é sobrescrito sem confirmação.
- Alterar as datas da viagem pode devolver `TRIP_DATE_CHANGE_CONFLICT`. Nesse caso os dias e atividades afetados
  aparecem na tela, e a exclusão só acontece com `confirmRemoveDates` depois de uma escolha explícita.
- Sem sucesso otimista: cada alteração espera o servidor e recarrega as consultas relacionadas.
- O limite de atividades por dia (10) vem de `GET /trips/:id/entitlements`. Ao atingir o limite, o formulário é
  preservado e orienta a escolher outro dia ou remover uma atividade.
- IA: antes de gerar, mostra disponibilidade e uso (`/ai/usage`). Cada pedido leva uma `Idempotency-Key`, reutilizada
  ao repetir a mesma operação. O polling do trabalho é limitado e para ao concluir, ao fechar o painel ou ao sair.
  Trabalhos em andamento são reencontrados ao voltar à viagem. Sugestões e ajustes são revisados antes de entrar no
  roteiro; ajustes que alteram ou removem atividades pedem confirmação. Itens não verificados aparecem marcados.
- Exportação PNG/PDF usa o roteiro salvo. O mapa é ilustrativo (sem API de mapas).

## Lacunas de contrato (alteração mínima sugerida no backend)

| Lacuna | Como o frontend lida hoje | Alteração mínima |
| --- | --- | --- |
| `AI_MAX_PROMPT_CHARS` e `AI_MAX_DAYS_PER_GENERATION` não aparecem na API | Usa os padrões documentados (500 caracteres, 7 dias) e trata `422` com `details.maxChars`/`maxDays` | Incluir `limits: { maxPromptChars, maxDaysPerGeneration }` em `GET /trips/:id/ai/usage` |
| `PATCH /trips/:id` não tem `version` | Só o proprietário edita a viagem, então o risco se limita a duas abas dele (vale a última gravação) | Campo `version` na viagem, opcional no `UpdateTripDto`, com `409 VERSION_CONFLICT` |
| Reduzir datas só exclui dias (não há "mover") | Lista os dias e atividades afetados e pede confirmação; para manter as atividades, a pessoa as move antes (campo "Dia" no formulário) | Opcional: parâmetro para mover as atividades para outro dia na mesma transação |

## Dependências externas pendentes

- **E-mail:** em desenvolvimento os convites ficam em `GET /api/v1/dev/outbox`. Para envio real, configure o Resend
  no backend.
- **Busca de locais (Geoapify):** sem `GEOAPIFY_API_KEY` no backend, o campo "Local" avisa que a busca está
  indisponível e salva o texto livre. Configuração e custos: `backend/README.md` → "Localização e mapa". O mapa em si
  usa OpenFreeMap e não consome créditos.
- **IA:** em desenvolvimento o backend usa o provedor `mock`. Para respostas reais, configure a chave da Anthropic no
  backend.
