// Missing evidence never becomes a negative assertion. Consume one run only.
export function derive(events) {
  const result = {
    EVIDENCE_VALID: 'YES', RUNTIME_EXECUTION_PROVEN: 'NOT_EVIDENCED',
    DIRECT_URL_PRESENCE_CHECK_PROVEN: 'NOT_EVIDENCED', URL_NORMALIZATION_PROVEN: 'NOT_EVIDENCED',
    DATABASE_CONNECTION_ATTEMPTED: 'NOT_EVIDENCED',
    BUILD_PIPELINE_RESULT: 'NOT_EVIDENCED', FUNCTION_PACKAGING_RESULT: 'NOT_EVIDENCED',
    FUNCTION_RUNTIME_INVOCATION_RESULT: 'NOT_EVIDENCED', V11_PROCESS_EXIT_CODE: 'INDETERMINATE',
  };
  for (const stage of ['PG', 'PRISMA']) {
    for (const [key, value] of Object.entries({CONNECTION_ATTEMPTED: 'NOT_EVIDENCED',
      CONNECTION_RESULT: 'INDETERMINATE', TLS_ACTIVE: 'INDETERMINATE',
      READ_ONLY_CONFIRMED: 'NOT_EVIDENCED', DISCONNECTED: 'NOT_EVIDENCED'})) result[`${stage}_${key}`] = value;
  }
  const seen = new Set();
  let valid = Array.isArray(events);
  if (!valid) return {...result, EVIDENCE_VALID: 'NO'};
  const prerequisites = {
    V11_ENV_CHECK_START: 'V11_RUNTIME_START', V11_ENV_CHECK_OK: 'V11_ENV_CHECK_START',
    V11_URL_NORMALIZED: 'V11_ENV_CHECK_OK', V11_FINGERPRINT_READY: 'V11_URL_NORMALIZED',
    V11_DRY_RUN_COMPLETE: 'V11_FINGERPRINT_READY', V11_PG_PROBE_START: 'V11_FINGERPRINT_READY',
    V11_PRISMA_PROBE_START: 'V11_PG_DISCONNECTED', V11_PROBE_COMPLETE: 'V11_PRISMA_DISCONNECTED',
  };
  for (const stage of ['PG', 'PRISMA']) {
    for (const [marker, required] of [['CONNECT_ATTEMPT','PROBE_START'], ['CONNECTED','CONNECT_ATTEMPT'],
      ['CONNECT_ERROR','CONNECT_ATTEMPT'], ['READ_ONLY_CONFIRMED','CONNECTED'],
      ['TLS_CONFIRMED','READ_ONLY_CONFIRMED'], ['QUERY_ERROR','CONNECTED'], ['DISCONNECTED','CONNECT_ATTEMPT']]) {
      prerequisites[`V11_${stage}_${marker}`] = `V11_${stage}_${required}`;
    }
  }
  const allowed = new Set([...Object.keys(prerequisites), 'V11_RUNTIME_START', 'V11_ENV_ERROR',
    'V11_INTERNAL_ERROR','V11_STAGE_NOT_RUN','V11_PROCESS_EXIT_SUCCESS','V11_PROCESS_EXIT_FAILURE']);
  for (const [i, event] of events.entries()) {
    const m = event?.marker;
    if (!event || !allowed.has(m) || event.sequence !== i+1 || !/^[0-9a-f-]{36}$/.test(event.run_id) ||
      event.run_id !== events[0].run_id || !Number.isFinite(Date.parse(event.timestamp)) ||
      (i===0 && m!=='V11_RUNTIME_START') ||
      (seen.has(m) && !['V11_STAGE_NOT_RUN','V11_INTERNAL_ERROR'].includes(m)) ||
      (prerequisites[m] && !seen.has(prerequisites[m])) ||
      seen.has('V11_PROCESS_EXIT_SUCCESS') || seen.has('V11_PROCESS_EXIT_FAILURE')) valid=false;
    if (m==='V11_PROCESS_EXIT_SUCCESS' && (event.exit_code!==0 ||
      (!seen.has('V11_DRY_RUN_COMPLETE') && !seen.has('V11_PROBE_COMPLETE')))) valid=false;
    seen.add(m);
  }
  const has = m => seen.has(m);
  const dry = has('V11_DRY_RUN_COMPLETE');
  const position = marker => events.findIndex(e => e?.marker === marker);
  for (const stage of ['PG','PRISMA']) {
    const close = position(`V11_${stage}_DISCONNECTED`);
    if (close >= 0 && events.some((e,i) => i > close && e?.marker?.startsWith(`V11_${stage}_`))) valid=false;
  }
  const completed = Math.max(position('V11_DRY_RUN_COMPLETE'), position('V11_PROBE_COMPLETE'));
  if (completed >= 0 && events.some((e,i) => i > completed && !/^V11_PROCESS_EXIT_(SUCCESS|FAILURE)$/.test(e?.marker))) valid=false;

  const errors = events.filter(e => /_ERROR$/.test(e?.marker));
  if (has('V11_PROBE_COMPLETE') && (!has('V11_PG_TLS_CONFIRMED') || !has('V11_PRISMA_TLS_CONFIRMED'))) valid=false;
  if (has('V11_PRISMA_PROBE_START') && !has('V11_PG_TLS_CONFIRMED')) valid=false;
  if ((has('V11_PROBE_COMPLETE') || has('V11_PROCESS_EXIT_SUCCESS') || dry) && errors.length) valid=false;
  for (const stage of ['PG','PRISMA']) {
    if (has(`V11_${stage}_CONNECTED`) && has(`V11_${stage}_CONNECT_ERROR`)) valid=false;
    if (dry && events.some(e=>e?.marker?.startsWith(`V11_${stage}_`))) valid=false;
    if (events.some(e=>e?.marker==='V11_STAGE_NOT_RUN' && e.stage===stage) && has(`V11_${stage}_CONNECT_ATTEMPT`)) valid=false;
  }
  if (!valid) return {...result,EVIDENCE_VALID:'NO'};
  if (has('V11_RUNTIME_START')) result.RUNTIME_EXECUTION_PROVEN='YES';
  if (has('V11_ENV_CHECK_OK')) result.DIRECT_URL_PRESENCE_CHECK_PROVEN='YES';
  if (has('V11_URL_NORMALIZED')) result.URL_NORMALIZATION_PROVEN='YES';
  for (const stage of ['PG','PRISMA']) {
    const prefix=`V11_${stage}_`;
    const skipped=events.some(e=>e.marker==='V11_STAGE_NOT_RUN' && e.stage===stage && (
      (e.reason==='ENV_FAILED' && has('V11_ENV_ERROR')) ||
      (e.reason==='GATE_REJECTED' && errors.some(x=>['DRY_RUN_PASS_REQUIRED','DRIVERS_REQUIRED'].includes(x.reason))) ||
      (stage==='PRISMA' && e.reason==='PG_FAILED' && errors.some(x=>x.marker.startsWith('V11_PG_') || x.stage==='PG'))));
    if (dry || skipped) {
      result[`${stage}_CONNECTION_ATTEMPTED`]='NO'; result[`${stage}_CONNECTION_RESULT`]='NOT_RUN';
    }
    if (has(prefix+'CONNECT_ATTEMPT')) result[`${stage}_CONNECTION_ATTEMPTED`]='YES';
    if (has(prefix+'CONNECT_ERROR')) result[`${stage}_CONNECTION_RESULT`]='FAIL';
    if (has(prefix+'CONNECTED')) result[`${stage}_CONNECTION_RESULT`]='PASS';
    if (has(prefix+'TLS_CONFIRMED')) result[`${stage}_TLS_ACTIVE`]='YES';
    if (errors.some(e=>e.marker===prefix+'QUERY_ERROR' && e.reason==='TLS_INACTIVE')) result[`${stage}_TLS_ACTIVE`]='NO';
    if (has(prefix+'READ_ONLY_CONFIRMED')) result[`${stage}_READ_ONLY_CONFIRMED`]='YES';
    if (has(prefix+'DISCONNECTED')) result[`${stage}_DISCONNECTED`]='YES';
  }
  if (['PG','PRISMA'].some(s=>result[`${s}_CONNECTION_ATTEMPTED`]==='YES')) result.DATABASE_CONNECTION_ATTEMPTED='YES';
  else if (['PG','PRISMA'].every(s=>result[`${s}_CONNECTION_ATTEMPTED`]==='NO')) result.DATABASE_CONNECTION_ATTEMPTED='NO';
  const exit=events.find(e=>/^V11_PROCESS_EXIT_(SUCCESS|FAILURE)$/.test(e.marker));
  if (exit && Number.isInteger(exit.exit_code)) result.V11_PROCESS_EXIT_CODE=exit.exit_code;
  return result;
}
