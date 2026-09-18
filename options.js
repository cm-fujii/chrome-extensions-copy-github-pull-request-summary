// 既定値は content.js の DEFAULT_SETTINGS と揃える
const DEFAULT_SETTINGS = { removeImages: false }

const checkbox = document.getElementById('removeImages')

chrome.storage.sync
  .get(DEFAULT_SETTINGS)
  .then(({ removeImages }) => {
    checkbox.checked = removeImages
  })
  .catch((error) => console.error('[Copy PR Summary] 設定の読み込みに失敗しました', error))

// 保存ボタンを置かず、切り替えた瞬間に保存する
checkbox.addEventListener('change', () => {
  chrome.storage.sync
    .set({ removeImages: checkbox.checked })
    .catch((error) => console.error('[Copy PR Summary] 設定の保存に失敗しました', error))
})
