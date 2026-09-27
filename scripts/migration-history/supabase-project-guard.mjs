/**
 * Fail-closed: prova a identidade do projeto Supabase a partir da URL de conexao.
 *
 * SAME-TARGET INVARIANT: o valor normalizado e validado aqui e o MESMO
 * handed ao pg Client. Nao reler env, nao renormalizar, nao reavaliar.
 * Se o driver falhar com hostname diferente do validado -> CONNECTION_TARGET_DIVERGENCE,
 * que NAO e retryable (ao contrario de EAI_AGAIN no hostname correto).
 *
 * A CLI serializa SOMENTE {parsed, projectGuard, connectionMode}.
 * connectionString e hostname existem apenas em memoria.
 */
export const EXPECTED_PROJECT_REF = 'ujskptfrbbaslvqrqzxa';
const SENSITIVE = /[Ss][Ee][Nn][Ss][Ii][Tt][Ii][Vv][Ee]|PASSWORD|SECRET|TOKEN/i;
const SAFE_KEYS = ['parsed', 'projectGuard', 'connectionMode'];

export function normalizeConnectionString(raw) {
  if (typeof raw !== 'string') return null;
  let v = raw.trim();
  if (!v || SENSITIVE.test(v)) return null;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
    if (!v) return null;
  }
  return /^postgres(ql)?:/i.test(v) ? v : null;
}

export function validateSupabaseTarget(raw, ref = EXPECTED_PROJECT_REF) {
  const connectionString = normalizeConnectionString(raw);
  if (!connectionString) return { parsed: false, projectGuard: false, connectionMode: 'UNKNOWN', connectionString: null, hostname: null };
  let u;
  try { u = new URL(connectionString); } catch { return { parsed: false, projectGuard: false, connectionMode: 'UNKNOWN', connectionString: null, hostname: null }; }
  const hostname = u.hostname.toLowerCase();
  let username = '';
  try { username = decodeURIComponent(u.username); } catch { username = u.username; }
  const direct = hostname === `db.${ref}.supabase.co`;
  const pooler = hostname.endsWith('.pooler.supabase.com') && username === `postgres.${ref}`;
  const ok = direct || pooler;
  return {
    parsed: true,
    projectGuard: ok,
    connectionMode: ok ? (direct ? 'DIRECT' : 'POOLER') : 'UNKNOWN',
    connectionString,
    hostname,
  };
}

export function evaluateGuard(raw, ref = EXPECTED_PROJECT_REF) {
  const r = validateSupabaseTarget(raw, ref);
  return { parsed: r.parsed, projectGuard: r.projectGuard, connectionMode: r.connectionMode };
}

export function assertSameTarget(err, validated) {
  const h = err && err.hostname;
  if (!h) return 'NO_HOSTNAME_IN_ERROR';
  if (h.toLowerCase() !== String(validated.hostname).toLowerCase()) return 'CONNECTION_TARGET_DIVERGENCE';
  return err.code === 'EAI_AGAIN' ? 'RETRYABLE_EAI_AGAIN' : 'NON_RETRYABLE';
}

export function safeOutput(r) {
  return Object.fromEntries(SAFE_KEYS.map(k => [k, r[k]]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = {};
  for (const line of (process.env.SUPABASE_ENV_DUMP || '').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  const r = evaluateGuard(process.env.GUARD_URL ?? env.DIRECT_URL ?? env.DATABASE_URL);
  console.log(JSON.stringify(safeOutput(r)));
  process.exitCode = r.projectGuard ? 0 : 1;
}
