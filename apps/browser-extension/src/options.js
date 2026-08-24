/* Handles explicit local pairing without collecting platform credentials. */
const form = document.querySelector('#pair-form');
const status = document.querySelector('#status');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '正在连接…';
  const port = Number(document.querySelector('#port').value);
  const code = document.querySelector('#code').value.trim();
  const result = await chrome.runtime.sendMessage({ type: 'pair', port, code });
  status.textContent = result?.ok ? '已连接 Megumi。' : `连接失败：${result?.message ?? '未知错误'}`;
});
