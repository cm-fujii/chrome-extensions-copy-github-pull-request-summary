const MENU_ID = 'copy-pull-request-summary'

// onInstalled は更新時にも走るため、作り直さないと重複 ID で登録に失敗する
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Pull Request概要コピー',
      contexts: ['all'],
      // PR ページ配下（Conversation / Commits / Files changed など全タブ）でのみ出す
      documentUrlPatterns: ['https://github.com/*/*/pull/*'],
    })
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return

  // 常駐 content script を置かず、クリック時にだけ注入する。
  // content.js は再注入されても壊れないよう全体が IIFE になっている。
  chrome.scripting
    .executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    .catch((error) => console.error('[Copy PR Summary] 注入に失敗しました', error))
})
