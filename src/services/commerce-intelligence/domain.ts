import { createHash } from 'node:crypto';

export type IdentifierType = 'GTIN' | 'EAN' | 'UPC' | 'ISBN' | 'MPN' | 'MODEL' | 'BRAND_SKU' | 'MARKETPLACE_EXTERNAL_ID';
export type TruthState = 'EXACT' | 'ESTIMATED' | 'PARTIAL' | 'UNKNOWN';
export type Attributes = Record<string, unknown> | Array<{id?: string; name?: string; value?: unknown; value_name?: unknown}>;
const text = (v: unknown) => String(v ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
function entries(input: Attributes): [string, unknown][] {
  return Array.isArray(input) ? input.map(a => [a.id ?? a.name ?? '', a.value_name ?? a.value]) : Object.entries(input);
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => [k, stable(v)]));
  return value;
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const aliases: Record<string, string> = {
  color: 'color', cor: 'color', size: 'size', tamanho: 'size', voltage: 'voltage', voltagem: 'voltage',
  capacity: 'capacity', capacidade: 'capacity', storage: 'storage', armazenamento: 'storage',
  internal_memory: 'storage', memory: 'memory', memoria: 'memory', ram: 'memory', ram_memory: 'memory', model: 'modelNumber', model_number: 'modelNumber', modelnumber: 'modelNumber',
};
export function normalizeAttributes(input: Attributes): Record<string, string> {
  const collected = new Map<string, Set<string>>();
  for (const [key, raw] of entries(input)) {
    const alias = text(key).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[ -]/g, '_');
    const name = Object.hasOwn(aliases, alias) ? aliases[alias] : undefined;
    if (!name || raw == null || (typeof raw !== 'string' && typeof raw !== 'number')) continue;
    const value = text(raw).replace(/(\d)\s+(gb|tb|mb|v)\b/g, '$1$2');
    if (!value) continue;
    const values = collected.get(name) ?? new Set<string>(); values.add(value); collected.set(name, values);
  }
  // Conflicting observed values are preserved, never silently selected by input order.
  return Object.fromEntries([...collected].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => [k, [...v].sort().join('|')]));
}
export function buildVariantKey(attributes: Attributes): string {
  return 'v1:' + hash(normalizeAttributes(attributes));
}
export interface ObservedIdentifier {
  type: IdentifierType; value: string; normalizedValue: string; valid: boolean;
  marketplace?: string; brandScope?: string;
}
function checkDigits(value: string): boolean {
  let sum = 0;
  for (let i = value.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) sum += Number(value[i]) * weight;
  return (10 - sum % 10) % 10 === Number(value.at(-1));
}
export function extractIdentifiers(listing: {attributes?: Attributes; marketplace?: string; externalId?: string; brand?: string; gtin?: string; ean?: string; upc?: string; isbn?: string; mpn?: string; modelNumber?: string}): ObservedIdentifier[] {
  const mapping: Record<string, IdentifierType> = {gtin: 'GTIN', ean: 'EAN', upc: 'UPC', isbn: 'ISBN', mpn: 'MPN', model: 'MODEL', modelnumber: 'MODEL', model_number: 'MODEL', brand_sku: 'BRAND_SKU'};
  const values = [...entries(listing.attributes ?? {}), ...Object.entries(listing).filter(([k]) => k !== 'attributes')];
  const output: ObservedIdentifier[] = [];
  for (const [key, raw] of values) {
    const type = Object.hasOwn(mapping, text(key)) ? mapping[text(key)] : undefined;
    if (!type || typeof raw !== 'string' || !raw.trim()) continue;
    const value = raw; let normalizedValue = text(value).toUpperCase(); let valid = true;
    if (['GTIN', 'EAN', 'UPC', 'ISBN'].includes(type)) {
      normalizedValue = normalizedValue.replace(/[\s-]/g, '');
      const lengths = type === 'GTIN' ? [8,12,13,14] : type === 'EAN' ? [8,13] : type === 'UPC' ? [12] : [10,13];
      valid = lengths.includes(normalizedValue.length) && !/^0+$/.test(normalizedValue) && /^\d+$/.test(normalizedValue) && checkDigits(normalizedValue);
      if (type === 'ISBN' && normalizedValue.length === 10) valid = /^\d{9}[\dX]$/.test(normalizedValue) && [...normalizedValue].reduce((s,c,i) => s + (c === 'X' ? 10 : Number(c)) * (10-i), 0) % 11 === 0;
      if (type === 'ISBN' && normalizedValue.length === 13) valid = valid && /^(978|979)/.test(normalizedValue);
    }
    const brandScope = ['MPN','BRAND_SKU','MODEL'].includes(type) ? text(listing.brand) || undefined : undefined;
    output.push({type,value,normalizedValue,valid, ...(brandScope ? {brandScope} : {})});
  }
  if (listing.externalId?.trim() && listing.marketplace?.trim()) output.push({type:'MARKETPLACE_EXTERNAL_ID', value:listing.externalId, normalizedValue:text(listing.externalId).toUpperCase(), marketplace:text(listing.marketplace).toUpperCase(), valid:true});
  return [...new Map(output.map(i => [JSON.stringify([i.type,i.normalizedValue,i.marketplace,i.brandScope]), i])).values()].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
}
export function identifiersConflict(a: ObservedIdentifier, b: ObservedIdentifier): boolean {
  if (!a.valid || !b.valid || a.type !== b.type || a.normalizedValue !== b.normalizedValue) return false;
  if (a.type === 'MARKETPLACE_EXTERNAL_ID') return !!a.marketplace && a.marketplace === b.marketplace;
  if (['MPN','MODEL','BRAND_SKU'].includes(a.type)) return !!a.brandScope && a.brandScope === b.brandScope;
  return true;
}
export type ComponentType = 'LIST_PRICE' | 'SALE_PRICE' | 'SHIPPING' | 'COUPON' | 'PIX_DISCOUNT' | 'MEMBERSHIP_PRICE' | 'INSTALLMENT_TOTAL' | 'FINAL_EFFECTIVE_PRICE';
export interface PriceComponent {
  source?: string;
  type: ComponentType; amount?: string | number | null; currency: string; truthState: TruthState;
  conditions?: { eligible?: boolean; [key: string]: unknown } | null;
}
export interface ObservationState {
  attributes?: Attributes;
  marketplace: string; externalId: string; sellerId?: string | null; sellerName?: string | null;
  title?: string | null; sourceUrl?: string | null; affiliateLink?: string | null;
  price?: string | number | null; oldPrice?: string | number | null; currency: string;
  stock?: number | null; available?: boolean | null; components?: PriceComponent[];
}
function money(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value); if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error('INVALID_MONEY');
  const [integer, fractional = ''] = s.split('.'); return BigInt(integer).toString() + '.' + fractional.padEnd(6, '0');
}
export function buildObservationFingerprint(input: ObservationState): string {
  const components = (input.components ?? []).map(c => ({type:c.type, amount:money(c.amount), currency:c.currency.toUpperCase(), truthState:c.truthState, conditions:c.conditions ?? null}));
  components.sort((a,b) => JSON.stringify(stable(a)).localeCompare(JSON.stringify(stable(b)),'en'));
  const state = {marketplace:input.marketplace, externalId:input.externalId, sellerId:input.sellerId ?? null, sellerName:input.sellerName ?? null, title:input.title ?? null, sourceUrl:input.sourceUrl ?? null, affiliateLink:input.affiliateLink ?? null, price:money(input.price), oldPrice:money(input.oldPrice), currency:input.currency.toUpperCase(), stock:input.stock ?? null, available:input.available ?? null, components};
  return (input.attributes === undefined ? 'v1:' : 'v2:') + hash(input.attributes === undefined ? state : {...state,attributes:normalizeAttributes(input.attributes)});
}
export function computeEffectivePrice(components: PriceComponent[]): {value?: string; state: TruthState; explanation: {used: ComponentType[]; missing: string[]; conditional: ComponentType[]}} {
  const explanation: {used: ComponentType[]; missing: string[]; conditional: ComponentType[]} = {used:[],missing:[],conditional:[]};
  const usable = components.filter(c => {
    if ((c.conditions && c.conditions.eligible !== true) || (['COUPON','PIX_DISCOUNT','MEMBERSHIP_PRICE'].includes(c.type) && c.conditions?.eligible !== true)) { explanation.conditional.push(c.type); return false; }
    return c.amount != null && c.truthState !== 'UNKNOWN';
  });
  const finals = usable.filter(c => c.type === 'FINAL_EFFECTIVE_PRICE');
  const bases = finals.length ? finals : usable.filter(c => c.type === 'SALE_PRICE');
  const base = bases[0];
  if (!base || bases.length !== 1) return {state:'UNKNOWN', explanation:{...explanation, missing:[bases.length > 1 ? 'ambiguous base' : 'observed sale/final price']}};
  const selected = finals.length ? [base] : [base, ...usable.filter(c => ['SHIPPING','COUPON','PIX_DISCOUNT'].includes(c.type))];
  if (selected.some(c => c.currency.toUpperCase() !== base.currency.toUpperCase()) || new Set(selected.map(c => c.type)).size !== selected.length) return {state:'UNKNOWN', explanation:{...explanation,missing:['ambiguous components/currency']}};
  if (!finals.length && !selected.some(c => c.type === 'SHIPPING')) explanation.missing.push('shipping');
  if (components.some(c => c.amount == null || c.truthState === 'UNKNOWN')) explanation.missing.push('unresolved component');
  let micros = BigInt(0);
  try { for (const c of selected) { const amount = BigInt(money(c.amount)!.replace('.', '')); micros += ['COUPON','PIX_DISCOUNT'].includes(c.type) ? -amount : amount; explanation.used.push(c.type); } } catch { return {state:'UNKNOWN',explanation:{...explanation,missing:['invalid amount']}}; }
  if (micros < BigInt(0)) return {state:'UNKNOWN',explanation:{...explanation,missing:['negative effective price']}};
  const state: TruthState = explanation.missing.length || explanation.conditional.length || selected.some(c => c.truthState === 'PARTIAL') ? 'PARTIAL' : selected.some(c => c.truthState === 'ESTIMATED') ? 'ESTIMATED' : 'EXACT';
  return {value:(micros / BigInt(1000000)).toString()+'.'+(micros % BigInt(1000000)).toString().padStart(6,'0'),state,explanation};
}
