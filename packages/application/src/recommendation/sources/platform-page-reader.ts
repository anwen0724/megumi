/* Bundled read-only page reader; the Host selects these fixed operations. */
export const PLATFORM_PAGE_READER = `(() => {
  const rawText = document.body?.innerText || '';
  const title = document.title || '';
  const challenge = document.querySelector('.geetest_panel, #captcha, [class*="captcha-container"]') || /安全验证|人机验证|访问验证/.test(title);
  let login = document.querySelector('.LoginModal, .signFlowModal, .login-container, [data-testid="login-modal"]');
  const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 300).map(a => ({ href: a.href, text: (a.innerText || '').slice(0, 500), contextText: (a.closest('article,section,li,.note-item,.video-item')?.innerText || a.innerText || '').slice(0, 2000) }));
  let structuredData;
  let bodyText = rawText;
  if (location.hostname.endsWith('xiaohongshu.com')) {
    const state = window.__INITIAL_STATE__;
    const loggedIn = state?.user?.loggedIn;
    login = login || loggedIn === false || loggedIn?._value === false || document.querySelector('.login-btn, .login-button, .guest-login');
    const map = state?.note?.noteDetailMap;
    const id = location.pathname.split('/').filter(Boolean).pop();
    const note = id && map?.[id]?.note;
    if (note) structuredData = JSON.parse(JSON.stringify({ note }));
    bodyText = document.querySelector('#detail-desc, .note-content, .note-text')?.innerText || note?.desc || '';
  } else if (location.hostname.endsWith('zhihu.com')) {
    let state;
    try { state = JSON.parse(document.querySelector('#js-initialData')?.textContent || '{}'); } catch {}
    const entities = (state?.initialState || state)?.entities;
    const id = location.pathname.split('/').filter(Boolean).pop();
    if (entities) structuredData = { answers: entities.answers?.[id] ? { [id]: entities.answers[id] } : {}, articles: entities.articles?.[id] ? { [id]: entities.articles[id] } : {} };
    const answer = Array.from(document.querySelectorAll('.AnswerItem')).find(item => {
      try { return String(JSON.parse(item.getAttribute('data-zop') || '{}').itemId) === id; } catch { return false; }
    });
    bodyText = location.pathname.includes('/answer/') ? answer?.querySelector('.RichContent-inner, .RichText')?.innerText || '' : document.querySelector('.Post-RichText')?.innerText || '';
  } else if (location.hostname.endsWith('bilibili.com')) {
    const video = window.__INITIAL_STATE__?.videoData;
    if (video) structuredData = JSON.parse(JSON.stringify({ video }));
    bodyText = document.querySelector('#v_desc, .basic-desc-info, .video-desc')?.innerText || video?.desc || '';
  }
  const complete = Boolean(document.querySelector('.no-result,.no-content,.search-empty,[data-testid="no-results"]'));
  const points = Array.from(bodyText);
  return { finalUrl: location.href, title, bodyText: points.slice(0, 50000).join(''), truncated: points.length > 50000, links, ...(structuredData ? { structuredData } : {}), completed: complete, pageState: challenge ? 'challenge_required' : login ? 'login_required' : 'available' };
})()`;

export const PLATFORM_ORIGINS = {
  zhihu: ['https://www.zhihu.com', 'https://zhuanlan.zhihu.com'],
  bilibili: ['https://www.bilibili.com', 'https://search.bilibili.com'],
  xiaohongshu: ['https://www.xiaohongshu.com'],
} as const;
