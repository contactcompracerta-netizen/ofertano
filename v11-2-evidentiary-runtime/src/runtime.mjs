import { createHash, randomUUID } from 'node:crypto';

// Receipts are private, single-use capabilities, never accepted from log text.
const receipts = new WeakMap();
const fingerprint = value => 'sha256:' + createHash('sha256').update(value).digest('hex').slice(0, 16);

export function normalize(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('ENV_INVALID');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash) {
    throw new Error('ENV_INVALID');
  }
  url.searchParams.set('sslmode', 'require');
  return url.toString();
}

export function createRuntime(write) {
  const run_id = randomUUID();
  let sequence = 0;
  let started = false;
  let complete = false;
  let exited = false;
  // This closure accepts only internally constructed fields. Errors, environment
  // values, query rows and client objects are never serialized.
  const emit = (marker, fields = {}) => write(Object.freeze({
    run_id, marker, timestamp: new Date().toISOString(), sequence: ++sequence, ...fields,
  }));
  const skip = (stage, reason) => emit('V11_STAGE_NOT_RUN', { stage, reason });

  async function probe(stage, factory, url) {
    emit(`V11_${stage}_PROBE_START`);
    let client;
    let phase = 'CONSTRUCT';
    let ok = false;
    try {
      // Factories must construct without connecting. The adapter below enforces
      // this separation and exposes no arbitrary query operation.
      client = factory(url);
      phase = 'CONNECT';
      emit(`V11_${stage}_CONNECT_ATTEMPT`);
      await client.connect();
      emit(`V11_${stage}_CONNECTED`);
      phase = 'QUERY';
      const ro = await client.readOnly();
      if (!Array.isArray(ro) || ro.length !== 1 || ro[0]?.tr !== 'on') {
        emit(`V11_${stage}_QUERY_ERROR`, { reason: 'READ_ONLY_NOT_CONFIRMED' });
      } else {
        emit(`V11_${stage}_READ_ONLY_CONFIRMED`);
        const tls = await client.tls();
        if (!Array.isArray(tls) || tls.length !== 1 || typeof tls[0]?.ssl !== 'boolean') {
          emit(`V11_${stage}_QUERY_ERROR`, { reason: 'TLS_RESULT_INVALID' });
        } else if (!tls[0].ssl) {
          emit(`V11_${stage}_QUERY_ERROR`, { reason: 'TLS_INACTIVE' });
        } else if (stage === 'PG' && client.socketEncrypted() !== true) {
          emit(`V11_${stage}_QUERY_ERROR`, { reason: 'SOCKET_TLS_NOT_CONFIRMED' });
        } else {
          emit(`V11_${stage}_TLS_CONFIRMED`);
          ok = true;
        }
      }
    } catch {
      if (phase === 'CONSTRUCT') emit('V11_INTERNAL_ERROR', { stage, reason: 'CLIENT_CONSTRUCTION_FAILED' });
      else emit(`V11_${stage}_${phase}_ERROR`, { reason: 'OPERATION_REJECTED' });
    } finally {
      if (client) {
        try {
          await client.disconnect();
          emit(`V11_${stage}_DISCONNECTED`);
        } catch {
          ok = false;
          emit('V11_INTERNAL_ERROR', { stage, reason: 'DISCONNECT_FAILED' });
        }
      }
    }
    return ok;
  }

  return Object.freeze({
    async run({ env = {}, mode = 'dry-run', drivers, dryRunReceipt } = {}) {
      if (started) throw new Error('RUN_ALREADY_STARTED');
      started = true;
      emit('V11_RUNTIME_START');
      emit('V11_ENV_CHECK_START');
      let url;
      try {
        if (!['dry-run', 'real'].includes(mode)) throw new Error('MODE_INVALID');
        if (typeof env.DIRECT_URL !== 'string' || !env.DIRECT_URL.trim()) throw new Error('ENV_INVALID');
        if (env.V11_REQUIRE_PRODUCTION === 'true' &&
            (env.VERCEL_ENV !== 'production' || env.VERCEL_TARGET_ENV !== 'production')) {
          throw new Error('ENV_INVALID');
        }
        emit('V11_ENV_CHECK_OK');
        url = normalize(env.DIRECT_URL);
        emit('V11_URL_NORMALIZED');
      } catch {
        emit('V11_ENV_ERROR', { reason: 'ENV_VALIDATION_FAILED' });
        skip('PG', 'ENV_FAILED');
        skip('PRISMA', 'ENV_FAILED');
        return Object.freeze({ ok: false });
      }
      emit('V11_FINGERPRINT_READY', { fingerprint: fingerprint(url) });

      // Structural early return: no factory is read, imported or constructed.
      if (mode === 'dry-run') {
        const receipt = Object.freeze({});
        receipts.set(receipt, createHash('sha256').update(url).digest('hex'));
        emit('V11_DRY_RUN_COMPLETE');
        complete = true;
        return Object.freeze({ ok: true, receipt });
      }

      if (!dryRunReceipt || receipts.get(dryRunReceipt) !== createHash('sha256').update(url).digest('hex')) {
        emit('V11_INTERNAL_ERROR', { reason: 'DRY_RUN_PASS_REQUIRED' });
        skip('PG', 'GATE_REJECTED');
        skip('PRISMA', 'GATE_REJECTED');
        return Object.freeze({ ok: false });
      }
      receipts.delete(dryRunReceipt);
      if (!drivers || typeof drivers.pg !== 'function' || typeof drivers.prisma !== 'function') {
        emit('V11_INTERNAL_ERROR', { reason: 'DRIVERS_REQUIRED' });
        skip('PG', 'GATE_REJECTED');
        skip('PRISMA', 'GATE_REJECTED');
        return Object.freeze({ ok: false });
      }
      if (!await probe('PG', drivers.pg, url)) {
        skip('PRISMA', 'PG_FAILED');
        return Object.freeze({ ok: false });
      }
      if (!await probe('PRISMA', drivers.prisma, url)) return Object.freeze({ ok: false });
      emit('V11_PROBE_COMPLETE');
      complete = true;
      return Object.freeze({ ok: true });
    },
    // Call only from the host process's synchronous 'exit' hook. Completion of
    // run() alone is deliberately insufficient to claim process exit success.
    processExit(code) {
      if (!started || exited) return;
      exited = true;
      if (complete && code === 0) emit('V11_PROCESS_EXIT_SUCCESS', { exit_code: 0 });
      else emit('V11_PROCESS_EXIT_FAILURE', { exit_code: Number.isInteger(code) && code >= 0 && code <= 255 ? code : 1 });
    },
  });
}
