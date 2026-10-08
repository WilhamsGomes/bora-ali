/**
 * Cria (ou reaproveita) os produtos e preços do BoraAli no Stripe em MODO TESTE
 * e imprime as variáveis para o .env. Recusa chaves live.
 *
 *   STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup
 */
import Stripe from 'stripe';

const CATALOG = [
  { env: 'STRIPE_PRICE_PRO', lookupKey: 'boraali_pro_trip_brl', name: 'BoraAli PRO (por viagem)', amount: 990 },
  { env: 'STRIPE_PRICE_PRO_AI', lookupKey: 'boraali_pro_ai_trip_brl', name: 'BoraAli PRO + IA (por viagem)', amount: 1990 },
  { env: 'STRIPE_PRICE_UPGRADE_PRO_AI', lookupKey: 'boraali_upgrade_pro_ai_brl', name: 'Upgrade PRO → PRO + IA', amount: 1000 },
];

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith('sk_test_')) {
    throw new Error('Defina STRIPE_SECRET_KEY com uma chave de TESTE (sk_test_...). Chaves live são recusadas.');
  }
  const stripe = new Stripe(key);

  const lines: string[] = [];
  for (const item of CATALOG) {
    const existing = await stripe.prices.list({ lookup_keys: [item.lookupKey], active: true, limit: 1 });
    let price = existing.data[0];
    if (price && (price.unit_amount !== item.amount || price.currency !== 'brl' || price.type !== 'one_time')) {
      throw new Error(`Preço ${item.lookupKey} existe com valores diferentes do catálogo. Ajuste no Dashboard.`);
    }
    if (!price) {
      price = await stripe.prices.create({
        currency: 'brl',
        unit_amount: item.amount,
        lookup_key: item.lookupKey,
        product_data: { name: item.name },
      });
      console.log(`Criado: ${item.name} → ${price.id}`);
    } else {
      console.log(`Já existe: ${item.name} → ${price.id}`);
    }
    lines.push(`${item.env}=${price.id}`);
  }
  console.log('\nAdicione ao .env:\n' + lines.join('\n'));
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
