/* Exercises the built Electron app through its real DOM and preload in a synthetic Home. */
import assert from 'node:assert/strict';
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { startDesktopModelBoundary } from './desktop-model-boundary.mjs';
const require = createRequire(import.meta.url);
const repository = process.cwd();
const fixtureArg = process.argv.indexOf('--fixture');
if (!process.argv.includes('--run') || fixtureArg < 0) throw new Error('Use --run --fixture <new synthetic fixture.json>.');
const fixture = JSON.parse(readFileSync(process.argv[fixtureArg + 1], 'utf8'));
const preparedRoot = path.resolve(fixture.root);
if (fixture.scope !== 'synthetic-only' || !preparedRoot.startsWith(path.resolve('.tmp') + path.sep) || path.resolve(fixture.home) !== path.join(preparedRoot, 'home')) throw new Error('Only the prepared isolated fixture is accepted.');
const scenarioIndex = process.argv.indexOf('--scenario');
const scenario = scenarioIndex < 0 ? 'main' : process.argv[scenarioIndex + 1];
if (!['main', 'partial', 'interrupted'].includes(scenario)) throw new Error('Unknown verification scenario.');
const sourceHome = scenario === 'main' ? fixture.home : fixture.scenarioHomes[scenario];
if (!path.resolve(sourceHome).startsWith(preparedRoot + path.sep)) throw new Error('Scenario Home must remain in the fixture.');
const root = mkdtempSync(path.join(preparedRoot, `run-${scenario}-`));
cpSync(sourceHome, path.join(root, 'home'), { recursive: true });
fixture.home = path.join(root, 'home');
mkdirSync(path.join(root, 'apps/desktop/assets'), { recursive: true });
cpSync(path.join(repository, 'apps/desktop/assets/app-icon.ico'), path.join(root, 'apps/desktop/assets/app-icon.ico'));
cpSync(path.join(repository, 'packages/application/resources'), path.join(root, 'packages/application/resources'), { recursive: true });
writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'megumi-memory-verification', version: JSON.parse(readFileSync(path.join(repository, 'package.json'), 'utf8')).version, main: 'launch.cjs' }));
mkdirSync(path.join(root, 'chromium'));
const main = path.resolve(process.env.MEGUMI_BUILD_OUTPUT ?? '.vite', 'build/index.js');
if (!existsSync(main)) throw new Error('Build the current desktop first.');
const debugPort = Number(process.env.MEMORY_DESKTOP_DEBUG_PORT ?? 9865);
const faultFile = path.join(root, 'clear-fault.txt');
const report = { scope: 'synthetic-only', scenario, startedAt: new Date().toISOString(), root, checks: [], screenshots: [], errors: [] };
let child;
let socket;
let call;
let run = 0;
const lifecycle = process.argv.includes('--lifecycle');
const modelBoundary = lifecycle ? await startDesktopModelBoundary(path.join(root, 'model-boundary.jsonl')) : undefined;
if (lifecycle) report.modelBoundary = 'Local fixed OpenAI-compatible responses. Token fields are protocol placeholders, not effect or cost measurements.';

/** Starts the actual built main, with no application code substituted. */
async function launch() {
  run++;
  const commandFile = path.join(root, `command-${run}.json`);
  writeFileSync(commandFile, '{}');
  const wrapper = path.join(root, 'launch.cjs');
  writeFileSync(wrapper, `const fs = require('node:fs');
const { app } = require('electron');
const realUnlink = fs.unlinkSync;
const faultFile = ${JSON.stringify(faultFile)};
const faultTarget = ${JSON.stringify(path.join(fixture.home, 'memories', 'MEMORY.md'))};
fs.unlinkSync = function(file) { if (require('node:path').resolve(String(file)) === faultTarget && fs.existsSync(faultFile) && fs.readFileSync(faultFile, 'utf8') === 'on') throw Object.assign(new Error('Synthetic memory clear failure'), { code: 'EACCES' }); return realUnlink(file); };
process.env.MEGUMI_HOME = ${JSON.stringify(fixture.home)};
app.setPath('userData', ${JSON.stringify(path.join(root, 'chromium'))});
app.setName('Megumi memory verification');
app.commandLine.appendSwitch('remote-debugging-port', ${JSON.stringify(String(debugPort))});
const commandFile = ${JSON.stringify(commandFile)};
fs.watchFile(commandFile, { interval: 200 }, () => { const cmd = JSON.parse(fs.readFileSync(commandFile, 'utf8')); if (cmd.action === 'quit') app.quit(); });
app.on('will-quit', () => fs.unwatchFile(commandFile));
require(${JSON.stringify(main)});
`);
  child = spawn(require('electron'), [root], { cwd: root, windowsHide: true, env: { ...process.env, MEGUMI_HOME: fixture.home, MEGUMI_DESKTOP_FIXTURE_KEY: 'local-fictional-key', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.commandFile = commandFile;
  report.processes ??= []; report.processes.push({ pid: child.pid, run, root });
  const log = createWriteStream(path.join(root, `electron-${run}.log`));
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.once('close', () => log.end());
  const deadline = Date.now() + 30000;
  let target;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Electron exited: ${child.exitCode}`);
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(1000) }).then(response => response.json());
      target = targets.find(item => item.type === 'page' && item.url.includes('main_window') && !item.url.includes('character'));
    } catch { /* Debug transport is unavailable before Electron opens its first window. */ }
    if (target) break;
    await delay(200);
  }
  if (!target) throw new Error('The real Electron renderer did not start.');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map();
  socket.onmessage = message => {
    const event = JSON.parse(message.data);
    if (event.id) {
      const request = pending.get(event.id);
      if (request) { pending.delete(event.id); clearTimeout(request.timeout); event.error ? request.reject(new Error(event.error.message)) : request.resolve(event.result); }
    }
    if (event.method === 'Runtime.exceptionThrown') report.errors.push(event.params.exceptionDetails.text);
  };
  call = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    const timeout = setTimeout(() => { pending.delete(next); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(next, { resolve, reject, timeout }); socket.send(JSON.stringify({ id: next, method, params }));
  });
  await call('Runtime.enable');
  await until(`!!window.megumi?.memory && !!document.querySelector('[data-testid="app-body"]')`);
  await evaluate(`window.memoryRequest = (method, payload={}) => { const channels = {getStatus:'get-status',getRun:'get-run',listDocuments:'list-documents',readDocument:'read-document',updateDocument:'update-document',listSources:'list-sources',readSource:'read-source',setSourceEligibility:'set-source-eligibility',clearMemory:'clear'}; const channel='memory:'+channels[method]; return window.megumi.memory[method]({requestId:crypto.randomUUID(),payload,meta:{channel,source:'renderer',createdAt:new Date().toISOString()}}); }; true`);
  child.commandFile = commandFile;
}

/** Quits via Electron's lifecycle so pending storage and tracing are flushed. */
async function quit() {
  socket?.close();
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    writeFileSync(child.commandFile, JSON.stringify({ action: 'quit' }));
    const graceful = await Promise.race([exited.then(() => true), delay(10000, false, { ref: false })]);
    if (!graceful) { child.kill(); await exited; throw new Error('Electron required forced termination after graceful quit timed out.'); }
  }
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await evaluate(expression)) return; await delay(100); }
  throw new Error(`DOM/state condition was not reached: ${expression}`);
}
async function click(text, selector = 'button') {
  const condition = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node=>!node.disabled && (node.textContent.trim()===${JSON.stringify(text)} || node.getAttribute('aria-label')===${JSON.stringify(text)}))`;
  await until(`!!(${condition})`);
  await evaluate(`(${condition}).click(); true`);
}
async function screenshot(name) {
  if (process.argv.includes('--no-screenshots')) {
    const file = path.join(root, `${name}.txt`);
    writeFileSync(file, await evaluate('document.body.innerText'));
    report.domSnapshots ??= []; report.domSnapshots.push(file);
    return;
  }
  await evaluate(`Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>undefined))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
  const captured = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(root, `${name}.png`); writeFileSync(file, Buffer.from(captured.data, 'base64')); report.screenshots.push(file);
}
async function memory(method, payload = {}) {
  const result = await evaluate(`window.memoryRequest(${JSON.stringify(method)},${JSON.stringify(payload)})`);
  if (!result.ok) throw new Error(`Memory ${method}: ${result.data.code}`);
  return result.data;
}
async function openMemory() {
  await click('新建会话');
  if (!await evaluate(`document.querySelector('button[aria-controls="right-sidebar"]')?.getAttribute('aria-expanded') === 'true'`)) await click('Open project sidebar');
  await until(`document.querySelector('[data-testid="right-sidebar"]')?.getBoundingClientRect().width >= 280`);
  await click('打开项目记忆视图');
  await until(`!!document.querySelector('[role="region"][aria-label="记忆"]')`);
}
async function clickOriginalSource(text) {
  const target = `Array.from(document.querySelectorAll('[role="region"][aria-label="记忆"] article')).find(node=>node.querySelector('p')?.textContent==='Original')`;
  await until(`!!(${target})`);
  await evaluate(`Array.from((${target}).querySelectorAll('button')).find(node=>node.textContent.trim()===${JSON.stringify(text)}).click(); true`);
}
async function closeMemory() {
  await click('关闭', '[role="region"][aria-label="记忆"] header button');
  await until(`!document.querySelector('[data-testid="right-sidebar"]')`);
}
function checked(name, detail = {}) { report.checks.push({ name, passed: true, ...detail }); }

async function settingsPatch(patch) {
  const result = await evaluate(`(async()=>{const read=await window.megumi.settings.readSettings(); if(!read.ok) throw new Error(JSON.stringify(read)); return window.megumi.settings.updateSettings({expectedRevision:read.data.revision,patch:${JSON.stringify(patch)}});})()`);
  assert.equal(result.ok, true, JSON.stringify(result));
}

async function demonstrateEditedReuse() {
  const model = modelId => ({ providerId: 'desktop-fixture', modelId });
  const definition = { contextWindowTokens: 128000, maxOutputTokens: 8192, capabilities: { streaming: true, toolCalls: true } };
  await settingsPatch({ providers: { 'desktop-fixture': { api: 'openai-completions', baseUrl: modelBoundary.baseUrl, apiKeyEnv: 'MEGUMI_DESKTOP_FIXTURE_KEY', models: { extract: definition, consolidate: definition, task: definition } } },
    memory: { generateMemories: true, extractModel: model('extract'), consolidationModel: model('consolidate') } });
  await until(`Promise.all([window.memoryRequest('getStatus'),window.memoryRequest('readDocument',{path:'memory_summary.md'})]).then(([status,read])=>status.ok && status.data.memory.artifactState==='ready' && read.ok && read.data.document?.content.includes('desktop-reviewed'))`);
  const summary = await memory('readDocument', { path: 'memory_summary.md' });
  assert.ok(summary.document.content.includes('desktop-reviewed'));
  assert.ok(modelBoundary.calls.some(item => item.model === 'consolidate' && item.response.tool_calls?.some(call => call.function.name === 'memory_finish')));
  checked('Edited knowledge is consolidated through the actual desktop lifecycle and reflected in the summary');
  await closeMemory();
  const priorUsage = (await memory('listSources')).sources.find(source => source.sessionId === fixture.sourceId).usageCount;
  const payload = { projectId: 'w1', text: 'Read the edited example preference from MEMORY.md and cite it.', modelSelection: { provider_id: 'desktop-fixture', model_id: 'task' }, permissionMode: 'full_access' };
  const sent = await evaluate(`window.megumi.session.message.send({requestId:crypto.randomUUID(),payload:${JSON.stringify(payload)},meta:{channel:'session:message:send',source:'renderer',createdAt:new Date().toISOString()}})`);
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.equal(sent.data.type, 'agent_run');
  const sessionId = sent.data.session.id;
  const readSession = `window.megumi.session.read({requestId:crypto.randomUUID(),payload:{sessionId:${JSON.stringify(sessionId)}},meta:{channel:'session:read',source:'renderer',createdAt:new Date().toISOString()}})`;
  await until(`${readSession}.then(result=>result.ok && JSON.stringify(result.data).includes('Verified edited memory'))`);
  const persisted = await evaluate(readSession);
  writeFileSync(path.join(root, 'edited-task.json'), JSON.stringify(persisted, null, 2));
  const doc = await memory('readDocument', { path: 'MEMORY.md' });
  const reply = persisted.data.conversation.find(item => item.type === 'message' && item.message.kind === 'assistantReply')?.message;
  assert.ok(reply?.memoryCitations?.some(citation => citation.path === 'MEMORY.md' && citation.fileVersion === doc.document.version));
  assert.equal((await memory('listSources')).sources.find(source => source.sessionId === fixture.sourceId).usageCount, priorUsage + 1);
  checked('New desktop task reads the edited file and persists host-validated citations', { sessionId, fileVersion: doc.document.version });
  // Restart loads the IPC-created task into the normal sidebar and verifies its durable reply.
  await settingsPatch({ memory: { generateMemories: false, extractModel: null, consolidationModel: null } });
  await quit(); await launch();
  await until(`!!document.querySelector('[data-testid="project-row-icon-w1"]')`);
  await evaluate(`{const project=document.querySelector('[data-testid="project-row-icon-w1"]').closest('button');if(project.getAttribute('aria-expanded')!=='true')project.click();}true`);
  const sessionButton = `Array.from(document.querySelectorAll('button')).find(node=>node.getAttribute('aria-label')?.startsWith(${JSON.stringify('打开会话 ' + sent.data.session.title)}))`;
  await until(`!!(${sessionButton})`); await evaluate(`(${sessionButton}).click();true`);
  await until(`document.body.innerText.includes('Verified edited memory') && !!document.querySelector('section[aria-label="记忆来源"]')`);
  await screenshot('03b-new-task-citation');
  // Continue the existing exclusion/clear checks from an unconfigured generation state.
  await openMemory();
  await screenshot('03b-edited-and-consolidated');
}

try {
  await launch();
  if (scenario !== 'main') {
    const current = (await memory('getStatus')).memory;
    if (scenario === 'partial') assert.ok(current.recentRuns.some(item => item.result?.result === 'partial' && item.jobs.some(job => job.stage === 'extract' && job.status === 'failed')));
    else { assert.equal(current.artifactState, 'needsRepair'); assert.ok(current.recentRuns.some(item => item.status === 'cancelled')); }
    await openMemory(); await click('状态', '[role="tab"]'); await click('最近运行', 'summary');
    await until(`document.querySelector('[role="region"][aria-label="记忆"]').textContent.includes(${JSON.stringify(scenario === 'partial' ? '部分完成' : '需要修复')})`);
    await screenshot(`failure-${scenario}`);
    checked(scenario === 'partial' ? 'UI displays durable partial extraction and failed source job' : 'UI displays interrupted consolidation and blocks unverified artifacts');
    report.passed = true;
  } else {
  const initial = await memory('getStatus');
  assert.equal(initial.memory.artifactState, 'ready');
  assert.equal(initial.memory.generateMemories, false);
  assert.equal(initial.memory.useMemories, true);
  assert.equal(initial.memory.extractModel.status, 'unconfigured');
  checked('Existing knowledge remains available without a configured generation model');
  await until(`!!document.querySelector('[data-testid="project-row-icon-w1"]')`);
  await evaluate(`{ const project=document.querySelector('[data-testid="project-row-icon-w1"]').closest('button'); if(project.getAttribute('aria-expanded')!=='true') project.click(); } true`);
  await until(`!!document.querySelector('button[aria-label^="打开会话 Desktop memory verification"]')`);
  await evaluate(`document.querySelector('button[aria-label^="打开会话 Desktop memory verification"]').click(); true`);
  await until(`document.body.innerText.includes('Desktop acceptance answer') && !!document.querySelector('section[aria-label="记忆来源"]')`);
  assert.equal(await evaluate(`document.body.innerText.includes('<memory_citations>')`), false);
  await evaluate(`document.querySelector('section[aria-label="记忆来源"] button').click(); true`);
  await until(`!!document.querySelector('[role="region"][aria-label="记忆"]') && document.querySelector('[role="region"][aria-label="记忆"]').textContent.includes('Use TypeScript')`);
  checked('Saved conversation renders verified citations and opens the referenced document');
  await screenshot('00-conversation-citation');
  await closeMemory();
  await openMemory();
  await until(`document.querySelector('[role="region"][aria-label="记忆"]').textContent.includes('TypeScript')`);
  await screenshot('01-ready-summary');
  const originalWidth = await evaluate(`document.querySelector('[data-testid="right-sidebar"]').getBoundingClientRect().width`);
  await evaluate(`{const handle=document.querySelector('[aria-label="调整项目侧边栏宽度"]'); const x=handle.getBoundingClientRect().x; handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,button:0})); window.dispatchEvent(new PointerEvent('pointermove',{clientX:x-160})); window.dispatchEvent(new PointerEvent('pointerup'));}true`);
  await until(`document.querySelector('[data-testid="right-sidebar"]').getBoundingClientRect().width > ${originalWidth}`);
  const resized = await evaluate(`{const sidebar=document.querySelector('[data-testid="right-sidebar"]'); const nav=sidebar.querySelector('[role="tablist"]'); ({width:sidebar.getBoundingClientRect().width,navWidth:nav.clientWidth,navScrollWidth:nav.scrollWidth,bodyWidth:document.body.clientWidth,bodyScrollWidth:document.body.scrollWidth})}`);
  assert.ok(resized.width <= 640 && resized.width >= 280);
  assert.ok(resized.bodyScrollWidth <= resized.bodyWidth);
  assert.ok(resized.navScrollWidth <= resized.navWidth);
  checked('Right sidebar resizes and Chinese tabs fit without page overflow', resized);
  await screenshot('01b-resized-memory');
  await evaluate(`{const handle=document.querySelector('[aria-label="调整项目侧边栏宽度"]'); const x=handle.getBoundingClientRect().x; handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,button:0})); window.dispatchEvent(new PointerEvent('pointermove',{clientX:x+1000})); window.dispatchEvent(new PointerEvent('pointerup'));}true`);
  await until(`Math.round(document.querySelector('[data-testid="right-sidebar"]').getBoundingClientRect().width) === 280`);
  const narrow = await evaluate(`{const nav=document.querySelector('[role="tablist"]'); ({navWidth:nav.clientWidth,navScrollWidth:nav.scrollWidth,bodyWidth:document.body.clientWidth,bodyScrollWidth:document.body.scrollWidth})}`);
  assert.ok(narrow.navScrollWidth <= narrow.navWidth);
  assert.ok(narrow.bodyScrollWidth <= narrow.bodyWidth);
  checked('Chinese tabs fit at the minimum sidebar width', narrow);

  await click('来源', '[role="tab"]');
  await clickOriginalSource('查看原始来源');
  await until(`document.querySelector('[role="region"][aria-label="记忆"]').textContent.includes('fictional desktop acceptance conversation')`);
  checked('Original source evidence is readable through the real UI');
  await screenshot('02-original-source');
  await click('知识', '[role="tab"]');
  await click('编辑全文');
  await until(`!!document.querySelector('textarea[aria-label="编辑草稿"]')`);
  const original = await memory('readDocument', { path: 'MEMORY.md' });
  await evaluate(`{ const editor=document.querySelector('textarea[aria-label="编辑草稿"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor, editor.value.replace('Use TypeScript','Use desktop-reviewed TypeScript')); editor.dispatchEvent(new Event('input',{bubbles:true})); } true`);
  const concurrent = await memory('updateDocument', { requestId: 'desktop-concurrent', path: 'MEMORY.md', expectedVersion: original.document.version, content: original.document.content.replace('Use TypeScript', 'Use concurrent TypeScript') });
  assert.equal(concurrent.status, 'saved');
  await click('保存');
  await until(`document.querySelector('[role="region"][aria-label="记忆"]').textContent.includes('草稿已保留')`);
  assert.ok(await evaluate(`document.querySelector('textarea[aria-label="编辑草稿"]').value.includes('desktop-reviewed')`));
  checked('Concurrent edit rejects the stale version and retains the UI draft');
  await screenshot('03-conflict-draft');
  await click('读取最新内容');
  await click('保留合并草稿并采用最新版本');
  await click('保存');
  await until(`!document.querySelector('textarea[aria-label="编辑草稿"]')`);
  assert.ok((await memory('readDocument', { path: 'MEMORY.md' })).document.content.includes('desktop-reviewed'));
  checked('Explicit merged edit saves with the current version');
  if (lifecycle) await demonstrateEditedReuse();
  await click('来源', '[role="tab"]');
  await clickOriginalSource('排除');
  await until(`document.querySelector('[role="region"][aria-label="记忆"]').textContent.includes('已排除')`);
  assert.equal((await memory('listSources')).sources.find(source => source.sessionId === fixture.sourceId).eligibility, 'excluded');
  checked('Source exclusion persists without a model binding');
  await screenshot('04-source-exclusion');
  await closeMemory();
  await click('设置');
  await click('记忆', '[role="tab"]');
  await until(`document.querySelectorAll('input[type="checkbox"]').length===2`);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('input[type="checkbox"]')).map(node=>node.checked)`), [false, true]);
  await evaluate(`document.querySelectorAll('input[type="checkbox"]')[1].click(); true`);
  await click('保存');
  await until(`Array.from(document.querySelectorAll('button')).some(node=>node.textContent.trim()==='保存' && node.disabled)`);
  assert.equal((await memory('getStatus')).memory.useMemories, false);
  checked('Settings saves generation and consumption as independent switches');
  await screenshot('05-memory-settings');
  await quit();
  await launch();
  assert.equal((await memory('getStatus')).memory.useMemories, false);
  assert.ok((await memory('readDocument', { path: 'MEMORY.md' })).document.content.includes('desktop-reviewed'));
  assert.equal((await memory('listSources')).sources.find(source => source.sessionId === fixture.sourceId).eligibility, 'excluded');
  checked('Real Electron restart preserves edit, exclusion, and switches');
  await openMemory();
  await click('状态', '[role="tab"]');
  if (!await evaluate(`Array.from(document.querySelectorAll('details')).some(node=>node.open && node.querySelector('summary')?.textContent==='清空记忆')`)) await click('清空记忆', 'summary');
  await click('清空并关闭自动记忆');
  await until(`!!document.querySelector('[role="alertdialog"]')`);
  await screenshot('06-clear-confirmation');
  writeFileSync(faultFile, 'on');
  await click('确认清空并关闭');
  await until(`window.memoryRequest('getStatus').then(result=>result.ok && result.data.memory.recentRuns.some(run=>run.kind==='clear' && run.status==='failed'))`);
  await until(`document.querySelector('[role="region"][aria-label="记忆"]').textContent.includes('失败')`);
  checked('Real clear I/O failure is displayed and remains recoverable');
  await screenshot('06b-clear-failed');
  writeFileSync(faultFile, 'off');
  if (!await evaluate(`Array.from(document.querySelectorAll('details')).some(node=>node.open && node.querySelector('summary')?.textContent==='清空记忆')`)) await click('清空记忆', 'summary');
  await click('清空并关闭自动记忆');
  await click('确认清空并关闭');
  await until(`window.memoryRequest('getStatus').then(result=>result.ok && result.data.memory.artifactState==='empty')`);
  const empty = await memory('getStatus');
  assert.equal(empty.memory.generateMemories, false); assert.equal(empty.memory.useMemories, false);
  assert.equal((await memory('listDocuments')).documents.length, 0);
  checked('Clear removes automatic artifacts and disables both switches');
  await screenshot('07-empty');
  await quit();
  await launch();
  assert.equal((await memory('getStatus')).memory.artifactState, 'empty');
  assert.equal((await memory('listSources')).sources.find(source => source.sessionId === fixture.sourceId).eligibility, 'excluded');
  const originalSession = await evaluate(`window.megumi.session.read({requestId:crypto.randomUUID(),payload:{sessionId:'s1'},meta:{channel:'session:read',source:'renderer',createdAt:new Date().toISOString()}})`);
  assert.equal(originalSession.ok, true);
  assert.equal(originalSession.data.status, 'ok');
  assert.ok(JSON.stringify(originalSession.data.conversation).includes('fictional desktop acceptance conversation'));
  checked('Second restart retains empty memory, source exclusion, and original conversation');
  await openMemory();
  await until(`document.querySelector('[role="region"][aria-label="记忆"]').textContent.includes('暂无记忆')`);
  await screenshot('08-empty-restarted');
  report.passed = true;
  }
} catch (error) {
  report.passed = false; report.failure = String(error);
  if (call && socket?.readyState === WebSocket.OPEN) {
    try { await screenshot('failure'); report.body = await evaluate('document.body.innerText'); } catch { /* Preserve the original verification failure if the renderer closed. */ }
  }
  process.exitCode = 1;
} finally {
  try { await quit(); } catch (error) { report.shutdownFailure = String(error); report.passed = false; process.exitCode = 1; }
  await modelBoundary?.close();
  report.completedAt = new Date().toISOString();
  writeFileSync(path.join(root, 'desktop-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, root, checks: report.checks.length, failure: report.failure, shutdownFailure: report.shutdownFailure }));
}
