import { writeSync } from 'node:fs';
import { createRuntime } from './runtime.mjs';

// Dedicated entry point: no real-mode switch, driver import, dotenv or fallback.
const runtime = createRuntime(event => writeSync(1, JSON.stringify(event) + '\n'));
process.once('exit', code => runtime.processExit(code));
try {
  const result = await runtime.run({ env: process.env, mode: 'dry-run' });
  process.exitCode = result.ok ? 0 : 1;
} catch {
  // Never serialize raw errors: Node URL/driver errors may contain credentials.
  process.exitCode = 1;
}
