/* Maintains the authenticated Megumi connection and claims browser search tasks. */
import { dispatchTask } from './dispatcher.js';

const SOURCES = ['xiaohongshu', 'douyin', 'zhihu'];
let socket;

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('megumi-claim', { periodInMinutes: 1 }));
chrome.runtime.onStartup.addListener(() => { void connectSocket(); });
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === 'megumi-claim' && void claimAll());
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== 'pair') return false;
  void pair(message.port, message.code).then(respond, (error) => respond({ ok: false, message: error.message }));
  return true;
});

async function pair(port, code) {
  const response = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
  });
  if (!response.ok) throw new Error('配对码无效或已经过期。');
  const connection = await response.json();
  await chrome.storage.local.set({ megumiConnection: { port: connection.port, token: connection.token } });
  await connectSocket();
  return { ok: true };
}

async function connection() {
  return (await chrome.storage.local.get('megumiConnection')).megumiConnection;
}

async function authenticatedFetch(path, init = {}) {
  const current = await connection();
  if (!current) throw new Error('Megumi is not paired.');
  return fetch(`http://127.0.0.1:${current.port}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${current.token}` },
  });
}

async function claimAll() {
  for (const sourceId of SOURCES) await claimOne(sourceId);
  await authenticatedFetch('/heartbeat', { method: 'POST' }).catch(() => undefined);
}

async function claimOne(sourceId) {
  const response = await authenticatedFetch(`/tasks/claim?sourceId=${sourceId}`).catch(() => undefined);
  if (!response?.ok) return;
  const claim = await response.json();
  if (!claim.task) return;
  const result = await dispatchTask(claim.task);
  await authenticatedFetch(`/tasks/${encodeURIComponent(claim.task.taskId)}/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claimToken: claim.claimToken, result }),
  }).catch(() => undefined);
}

async function connectSocket() {
  const current = await connection();
  if (!current) return;
  socket?.close();
  socket = new WebSocket(`ws://127.0.0.1:${current.port}/events?token=${encodeURIComponent(current.token)}`);
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'task_available' && SOURCES.includes(message.sourceId)) void claimOne(message.sourceId);
    } catch { /* A malformed local notification is ignored; HTTP polling remains authoritative. */ }
  };
  socket.onclose = () => setTimeout(() => void connectSocket(), 10_000);
}

void connectSocket();
