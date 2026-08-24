/* Runs a background platform search and returns only normalized public card facts. */
const SEARCH_URLS = {
  xiaohongshu: (query) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`,
  douyin: (query) => `https://www.douyin.com/search/${encodeURIComponent(query)}`,
  zhihu: (query) => `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`,
};

export async function executePlatformSearch(request) {
  const tab = await chrome.tabs.create({ url: SEARCH_URLS[request.sourceId](request.query), active: false });
  if (!tab.id) return failed('invalid_response', 'Browser task tab was not created.');
  try {
    await waitForTab(tab.id, 45_000);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: extractInPage,
      args: [request.sourceId, request.limit],
    });
    return result ?? failed('invalid_response', 'Platform page returned no result.');
  } catch (error) {
    return failed('network_error', error instanceof Error ? error.message : 'Platform search failed.');
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

function extractInPage(sourceId, limit) {
  const pageText = document.body?.innerText ?? '';
  if (/登录后|登录\/注册|立即登录|扫码登录/u.test(pageText)) {
    return { status: 'failed', failure: { code: 'login_required', message: 'Platform login is required.' } };
  }
  if (/安全验证|访问异常|网络环境存在风险|验证后继续/u.test(pageText)) {
    return { status: 'failed', failure: { code: 'risk_control', message: 'Platform security verification is required.' } };
  }
  const patterns = {
    xiaohongshu: /\/(?:explore|discovery\/item)\/([\dA-Za-z]+)/u,
    douyin: /\/video\/(\d+)/u,
    zhihu: /\/(?:question\/\d+\/answer\/(\d+)|p\/(\d+)|question\/(\d+))/u,
  };
  const items = [];
  const seen = new Set();
  for (const anchor of document.querySelectorAll('a[href]')) {
    const url = new URL(anchor.href, location.href);
    const match = url.pathname.match(patterns[sourceId]);
    const stableId = match?.slice(1).find(Boolean);
    if (!stableId || seen.has(stableId)) continue;
    const container = anchor.closest('article, [class*="note-item"], [class*="ContentItem"], [class*="search-result"]') ?? anchor;
    const title = (anchor.getAttribute('title') || anchor.textContent || container.textContent || '').replace(/\s+/gu, ' ').trim();
    if (!title) continue;
    seen.add(stableId);
    const image = container.querySelector?.('img');
    const coverUrl = image?.src && /^https?:/u.test(image.src) ? image.src : undefined;
    const author = container.querySelector?.('[class*="author"], [class*="Author"], [class*="user"]')?.textContent?.trim();
    items.push({
      sourceContentId: sourceId === 'zhihu'
        ? `${url.pathname.includes('/answer/') ? 'answer' : url.pathname.startsWith('/p/') ? 'article' : 'question'}:${stableId}`
        : sourceId === 'douyin' ? `aweme:${stableId}` : `note:${stableId}`,
      url: url.toString(),
      title: title.slice(0, 500),
      ...(author ? { author: author.slice(0, 200) } : {}),
      ...(coverUrl ? { coverUrl } : {}),
      contentType: sourceId === 'douyin' ? 'video' : sourceId === 'zhihu' ? 'article' : 'post',
    });
    if (items.length >= limit) break;
  }
  return { status: 'success', items };
}

function waitForTab(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Platform page load timed out.')), timeoutMs);
    const listener = (changedId, change) => {
      if (changedId === tabId && change.status === 'complete') finish();
    };
    const finish = (error) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      error ? reject(error) : resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((current) => current.status === 'complete' && finish()).catch(reject);
  });
}

function failed(code, message) {
  return { status: 'failed', failure: { code, message } };
}
