import { availableUpgrades, decidePurchase, planFromPaidProducts } from './plan-policy';

describe('plan-policy', () => {
  describe('decidePurchase', () => {
    it.each([
      ['FREE', 'PRO', { product: 'PRO', amount: 990, targetPlan: 'PRO' }],
      ['FREE', 'PRO_AI', { product: 'PRO_AI', amount: 1990, targetPlan: 'PRO_AI' }],
      ['PRO', 'PRO_AI', { product: 'UPGRADE_PRO_AI', amount: 1000, targetPlan: 'PRO_AI' }],
    ] as const)('%s → %s', (current, desired, expected) => {
      expect(decidePurchase(current, desired)).toEqual({ ok: true, ...expected });
    });

    it.each([
      ['PRO', 'PRO', 'PLAN_ALREADY_ACTIVE'],
      ['PRO_AI', 'PRO_AI', 'PLAN_ALREADY_ACTIVE'],
      ['PRO_AI', 'PRO', 'PLAN_NOT_ELIGIBLE'],
      ['PRO', 'FREE', 'PLAN_NOT_ELIGIBLE'],
    ] as const)('%s → %s é recusado (%s)', (current, desired, reason) => {
      expect(decidePurchase(current, desired)).toEqual({ ok: false, reason });
    });
  });

  it('upgrades disponíveis por plano', () => {
    expect(availableUpgrades('FREE').map((u) => u.product)).toEqual(['PRO', 'PRO_AI']);
    expect(availableUpgrades('PRO')).toEqual([{ plan: 'PRO_AI', product: 'UPGRADE_PRO_AI', amount: 1000, currency: 'BRL' }]);
    expect(availableUpgrades('PRO_AI')).toEqual([]);
  });

  describe('planFromPaidProducts', () => {
    it.each([
      [[], 'FREE'],
      [['PRO'], 'PRO'],
      [['PRO_AI'], 'PRO_AI'],
      [['PRO', 'UPGRADE_PRO_AI'], 'PRO_AI'],
      [['UPGRADE_PRO_AI'], 'FREE'], // upgrade sem PRO vigente (ex.: PRO reembolsado) não vale sozinho
      [['PRO', 'PRO_AI'], 'PRO_AI'],
    ] as const)('%j → %s', (products, plan) => {
      expect(planFromPaidProducts([...products])).toBe(plan);
    });
  });
});
