import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
// Existing local parser only; no installation or package script execution.
const ts=require('typescript');
const root=new URL('../src/',import.meta.url);
const imports={
  'runtime.mjs':['node:crypto'], 'drivers.mjs':[], 'derive.mjs':[],
  'dry-run.mjs':['node:fs','./runtime.mjs'],
};
const queries=new Set(["SELECT current_setting('transaction_read_only') AS tr;",
  'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();']);
let queryCount=0;
const files=readdirSync(root).filter(x=>x.endsWith('.mjs')).sort();
assert.deepEqual(files,Object.keys(imports).sort());
for(const name of files){
  const source=readFileSync(new URL(name,root),'utf8');
  const ast=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length,0);
  const imported=[];
  const visit=node=>{
    if(ts.isImportDeclaration(node)) imported.push(node.moduleSpecifier.text);
    if(ts.isCallExpression(node)){
      const target=node.expression.getText(ast);
      assert.ok(!/\b(?:eval|Function|exec|execSync|execFile|spawn|spawnSync|fetch|require|import)\b/.test(target),`${name}: forbidden callable`);
      assert.ok(!/\$(?:executeRaw|queryRawUnsafe|executeRawUnsafe)/.test(target),`${name}: unsafe database call`);
      if(target==='client.query'){
        assert.equal(node.arguments.length,1);
        assert.ok(ts.isStringLiteral(node.arguments[0]));
        assert.ok(queries.has(node.arguments[0].text)); queryCount++;
      }
    }
    if(ts.isTaggedTemplateExpression(node)){
      assert.equal(node.tag.getText(ast),'client.$queryRaw');
      assert.ok(ts.isNoSubstitutionTemplateLiteral(node.template));
      assert.ok(queries.has(node.template.text)); queryCount++;
    }
    if(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)){
      assert.ok(!/\b(?:INSERT|UPDATE|DELETE|UPSERT|CREATE|ALTER|DROP|TRUNCATE|MERGE|COPY|GRANT|REVOKE)\b/i.test(node.text),`${name}: forbidden SQL token`);
      assert.ok(!/prisma\s+(?:migrate|db\s+push)|\bseed\b|dual-write|canary-write/i.test(node.text));
    }
    ts.forEachChild(node,visit);
  };
  visit(ast);
  assert.deepEqual(imported,imports[name]);
  assert.ok(!/https?:\/\/|postgres(?:ql)?:\/\//.test(source));
}
assert.equal(queryCount,4);
const runtime=readFileSync(new URL('runtime.mjs',root),'utf8');
const dryBranch=runtime.slice(runtime.indexOf("if (mode === 'dry-run')"),runtime.indexOf('if (!dryRunReceipt'));
assert.ok(dryBranch.includes('return Object.freeze({ ok: true, receipt })'));
assert.ok(!/drivers\.|probe\(|connect\(|import\(/.test(dryBranch));
const driverSource=readFileSync(new URL('drivers.mjs',root),'utf8');
assert.ok(driverSource.includes('default_transaction_read_only=on'));
assert.ok(driverSource.includes('OPTIONS_OVERRIDE_REJECTED'));
console.log(JSON.stringify({STATIC_SAFETY_SCAN:'PASS',SOURCE_FILES:files.length,
  FIXED_READ_QUERY_SITES:queryCount,DYNAMIC_SQL_SITES:0,DATABASE_LIBRARY_IMPORTS:0,
  DRY_RUN_DRIVER_REACHABILITY:'NONE',FORBIDDEN_WRITE_OPERATIONS:0}));
