// Ambiente fixo para os testes e2e (não lê .env). Banco separado: boraali_test.
// Nenhuma chamada externa é feita: Stripe, provedor de IA e e-mail são substituídos por fakes.
const base = process.env.DATABASE_URL_TEST ?? 'postgresql://boraali:boraali@localhost:5432/boraali_test?schema=public';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: base,
  LOG_LEVEL: 'silent',
  RUN_WORKERS: 'false',
  CORS_ORIGINS: 'http://localhost:3000',
  FRONTEND_URL: 'http://localhost:3000',
  JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123456',
  EMAIL_PROVIDER: 'dev',
  EMAIL_FROM: 'BoraAli Testes <convites@teste.dev>',
  INVITATION_RESEND_MIN_INTERVAL_SECONDS: '60',
  INVITATION_MAX_SENDS: '3',
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  STRIPE_PRICE_PRO: 'price_pro',
  STRIPE_PRICE_PRO_AI: 'price_pro_ai',
  STRIPE_PRICE_UPGRADE_PRO_AI: 'price_upgrade',
  // Configuração "real" de preços/orçamento; o provedor é sempre o fake dos testes.
  AI_PROVIDER: 'anthropic',
  ANTHROPIC_API_KEY: 'test-key-never-used',
  AI_MODEL: 'claude-sonnet-5-5',
  AI_MAX_OUTPUT_TOKENS: '1000',
  AI_TRIP_BUDGET: '0.50',
  AI_MAX_RETRIES: '2',
  AI_MAX_RETRY_WAIT_MS: '5000',
  AI_LIMIT_DAY_SUGGESTIONS: '2',
  AI_LIMIT_TRIP_SUGGESTIONS: '2',
  AI_LIMIT_ADJUST_ITINERARY: '2',
  AI_MAX_PROMPT_CHARS: '100',
  AI_MAX_DAYS_PER_GENERATION: '5',
  AI_DAYS_PER_CALL: '2',
  AI_MAX_SUGGESTIONS_PER_DAY: '2',
  // Busca de locais: o provedor é sempre o fake dos testes.
  GEOCODING_PROVIDER: 'geoapify',
  GEOAPIFY_API_KEY: 'test-key-never-used',
  GEOCODING_USER_LIMIT_PER_MINUTE: '5',
});
