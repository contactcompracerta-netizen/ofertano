/** Exact production-only overlay. Never used to generate the runtime client. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import contract from './production-equivalence-contract.json' with { type: 'json' };
export { contract };
export const requireState = (ok, code) => { if (!ok) throw new Error(code); };
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function classifyUnmanaged(schema) {
  const names = [...schema.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'').matchAll(/model\s+(\w+)\s*\{([^}]+)\}/g)].map(m=>({ model:m[1], table:m[2].match(/@@map\("([^"]+)"\)/)?.[1]??m[1] }));
  requireState(names.some(n=>n.model==='PriceAlert'&&n.table==='PriceAlert'),'PRICE_ALERT_MAPPING_CHANGED');
  requireState(!names.some(n=>['notifications','price_alerts'].includes(n.table)),'UNMANAGED_TABLE_BECAME_MANAGED');
  return names.map(n=>n.table);
}
export function verifyContractDefinition(c=contract) {
  // Pin the entire exact reviewed contract, including inventory, defaults and overlay ownership.
  requireState(fingerprint(c)===CONTRACT_SHA256,'EQUIVALENCE_CONTRACT_CHANGED');
}
export function verifyObservation(observed, c=contract) {
  verifyContractDefinition(c);
  requireState(fingerprint(observed.functions)===fingerprint(c.triggerFunctions),'TRIGGER_FUNCTION_CHANGED');
  requireState(fingerprint(observed.external)===fingerprint(c.externalFKs),'EXTERNAL_FK_CONTRACT_CHANGED');
  requireState(fingerprint(Object.keys(observed.shape).sort())===fingerprint(Object.keys(c.tables).sort()),'TABLE_INVENTORY_CHANGED');
  for(const name of Object.keys(c.tables)) requireState(fingerprint(observed.shape[name])===fingerprint(c.tables[name]),'PHYSICAL_SHAPE_CHANGED_'+name.toUpperCase());
  return Object.fromEntries(Object.entries(observed.shape).map(([n,s])=>[n,fingerprint(s)]));
}
export function productionEquivalenceSchema(schemaPath,c=contract) {
  verifyContractDefinition(c);
  let schema=fs.readFileSync(schemaPath,'utf8');classifyUnmanaged(schema);
  requireState(fingerprint(schema)===RUNTIME_SCHEMA_SHA256,'RUNTIME_SCHEMA_CHANGED_REVIEW_OVERLAY');
  schema=schema.replace('model Product {',`model Product {
  productionFavorites Favorite[] @relation("ProductionFavoriteProduct")
  productionNotifications notifications[] @relation("ProductionNotificationProduct")
  productionLegacyAlerts price_alerts[] @relation("ProductionLegacyAlertProduct")`);
  schema=schema.replace('model PriceAlert {',`model PriceAlert {
  productionEvents PriceAlertEvent[] @relation("ProductionPriceAlertEvent")
  armed Boolean @default(true)
  lastEvaluatedAt DateTime? @db.Timestamp(3)
  lastEvaluatedPrice Float?
  lastEvaluatedHadExact Boolean?
  lastTriggeredAt DateTime? @db.Timestamp(3)
  lastTriggeredPrice Float?`);
  schema=schema.replace('enum PriceAlertType {\n  ANY_DROP\n  TARGET\n}', 'enum PriceAlertType {\n  ANY_DROP\n  TARGET_PRICE\n  TARGET\n}');
  schema+=`\nmodel Favorite {
  id String @id
  userId String
  productId String
  createdAt DateTime @default(now()) @db.Timestamp(3)
  product Product @relation("ProductionFavoriteProduct", fields: [productId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  @@unique([userId, productId])
  @@index([userId, createdAt])
  @@index([userId])
}
model PriceAlertEvent {
  id String @id
  alertId String
  type PriceAlertType
  price Float
  previousReferencePrice Float?
  targetPrice Float?
  createdAt DateTime @default(now()) @db.Timestamp(3)
  alert PriceAlert @relation("ProductionPriceAlertEvent", fields: [alertId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  @@index([alertId, createdAt])
}
model notifications {
  id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  user_id String @db.Uuid
  product_id String
  price_alert_id String? @db.Uuid
  notification_type String
  title String
  message String
  previous_price Float?
  current_price Float
  target_price Float?
  dedupe_key String? @unique
  read_at DateTime? @db.Timestamptz(6)
  created_at DateTime @default(now()) @db.Timestamptz(6)
  product Product @relation("ProductionNotificationProduct", fields: [product_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  alert price_alerts? @relation(fields: [price_alert_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  @@index([product_id])
  @@index([user_id, read_at], map: "notifications_unread_idx")
  @@index([user_id, created_at(sort: Desc)], map: "notifications_user_created_idx")
  @@index([user_id])
}
model price_alerts {
  id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  user_id String @db.Uuid
  product_id String
  alert_type String @default("ANY_DROP")
  target_price Float?
  reference_price Float
  last_seen_price Float
  active Boolean @default(true)
  last_notified_price Float?
  last_notified_at DateTime? @db.Timestamptz(6)
  created_at DateTime @default(now()) @db.Timestamptz(6)
  updated_at DateTime @default(now()) @db.Timestamptz(6)
  product Product @relation("ProductionLegacyAlertProduct", fields: [product_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  notifications notifications[]
  @@unique([user_id, product_id], map: "price_alerts_user_product_unique")
  @@index([active])
  @@index([product_id, active], map: "price_alerts_product_active_idx")
  @@index([product_id])
  @@index([user_id])
}\n`;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ofertano-production-schema-'));
  const file=path.join(dir,'schema.prisma');fs.writeFileSync(file,schema,{mode:0o600});
  return {file,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
// Updated only after explicit contract review; never derived from live observations at runtime.
const CONTRACT_SHA256 = '1f601c891992bbd0ab39c059a1d715bb6a40740f2cfe31fccd7d60642b05485c';
// LISTING-FIRST: reemitido para o schema.prisma com `MarketplaceOffer.catalogProductId`
// + `@@index([marketplace, catalogProductId])`. Mudanca aditiva e revisada; o overlay
// de producao (unmanaged Favorite/PriceAlertEvent/notifications/price_alerts) nao muda.
const RUNTIME_SCHEMA_SHA256 = '6f5033e361a32a414e5395cd6104cc3c32ef8f7259426804b6bbb9eeec301659';
