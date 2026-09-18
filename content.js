// 右クリックメニューから注入され、その場で 1 回だけ実行される。
// 再注入されても識別子が衝突しないよう、全体を IIFE に閉じている。
;(async () => {
  'use strict'

  const TOAST_ID = 'copy-pr-summary-toast'
  const TOAST_DURATION_MS = 3000
  const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/
  const DOM_CHANGED = 'PR 情報を読み取れませんでした（GitHub の画面構成が変わった可能性があります）'

  // これ以外の要素はブロックとして扱う。GitHub は <task-lists> のような
  // カスタム要素でブロックを包むため、既知のインラインを列挙する方が安全。
  const INLINE_TAGS = new Set([
    'A', 'ABBR', 'B', 'BR', 'CITE', 'CODE', 'DEL', 'EM', 'G-EMOJI', 'I', 'IMG',
    'INPUT', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB',
    'SUP', 'SVG', 'TIME', 'TT', 'U', 'VAR',
  ])

  // ---------------------------------------------------------------- Markdown

  function wrap(text, marker) {
    const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/)
    // 前後の空白まで囲むと隣接語とくっついて強調が効かなくなる
    return core ? lead + marker + core + marker + trail : text
  }

  function inline(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\s+/g, ' ')
    if (node.nodeType !== Node.ELEMENT_NODE) return ''

    switch (node.tagName) {
      case 'BR':
        return '\n'
      case 'INPUT': // タスクリストのチェックボックスは listLines 側で処理する
        return ''
      case 'IMG':
        return `![${node.getAttribute('alt') || ''}](${node.src})`
      case 'CODE': {
        const raw = node.textContent
        // 内側のバッククォートより 1 本多い囲みにして壊れないようにする
        const longest = (raw.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0)
        const pad = raw.startsWith('`') || raw.endsWith('`') ? ' ' : ''
        const fence = '`'.repeat(longest + 1)
        return fence + pad + raw + pad + fence
      }
      case 'A': {
        const text = inlineChildren(node).trim()
        // 正規化後・正規化前のどちらかと一致すれば裸の URL リンクとみなす
        if (!node.href || text === node.href || text === node.getAttribute('href')) return text
        // URL に括弧や空白を含むと [](...) 記法が壊れるため <> 形式に切り替える
        return `[${text}](${/[()\s]/.test(node.href) ? `<${node.href}>` : node.href})`
      }
      case 'STRONG':
      case 'B':
        return wrap(inlineChildren(node), '**')
      case 'EM':
      case 'I':
        return wrap(inlineChildren(node), '*')
      case 'DEL':
      case 'S':
        return wrap(inlineChildren(node), '~~')
      default:
        return inlineChildren(node)
    }
  }

  function inlineChildren(el) {
    let out = ''
    for (const child of el.childNodes) out += inline(child)
    return out
  }

  function trimBlank(lines) {
    let start = 0
    let end = lines.length
    while (start < end && !lines[start].trim()) start += 1
    while (end > start && !lines[end - 1].trim()) end -= 1
    return lines.slice(start, end)
  }

  /** 子ノードを走査し、連続するインラインを 1 段落に、ブロックはブロックとして展開する */
  function childLines(el) {
    const lines = []
    let run = ''
    const flush = () => {
      const text = run.trim()
      if (text) lines.push(text, '')
      run = ''
    }
    for (const child of el.childNodes) {
      // SVG など HTML 名前空間外の要素は tagName が小文字になるため大文字に揃える
      const isBlock =
        child.nodeType === Node.ELEMENT_NODE && !INLINE_TAGS.has(child.tagName.toUpperCase())
      if (isBlock) {
        flush()
        lines.push(...blockLines(child))
      } else {
        run += inline(child)
      }
    }
    flush()
    return lines
  }

  function codeBlockLines(pre) {
    const wrapper = pre.closest('[data-snippet-clipboard-copy-content]')
    const code = pre.querySelector('code')
    const lang = (
      pre.getAttribute('lang') ||
      (pre.parentElement?.getAttribute('class') || '').match(/highlight-source-([\w+#.-]+)/)?.[1] ||
      (code?.getAttribute('class') || '').match(/language-([\w+#.-]+)/)?.[1] ||
      ''
    ).replace(/[^\w+#.-]/g, '')

    // GitHub は元のソースを data 属性に保持しているので、あればそちらを使う
    const raw =
      wrapper?.getAttribute('data-snippet-clipboard-copy-content') ?? (code || pre).textContent
    const body = raw.replace(/\n+$/, '').split('\n')

    // 中身がコードフェンスを含んでもブロックが途中で閉じないよう、囲みを 1 本長くする
    const longest = body.reduce((max, line) => {
      const run = line.match(/^\s*(`{3,})/)
      return run ? Math.max(max, run[1].length) : max
    }, 2)
    const fence = '`'.repeat(longest + 1)

    return [fence + lang, ...body, fence, '']
  }

  function listLines(el) {
    const ordered = el.tagName === 'OL'
    const start = Number.parseInt(el.getAttribute('start') ?? '', 10)
    let index = Number.isNaN(start) ? 1 : start
    const lines = []

    for (const li of el.children) {
      if (li.tagName !== 'LI') continue

      const marker = ordered ? `${index++}. ` : '- '
      // 入れ子リストのチェックボックスを親項目が拾わないよう直下だけを見る
      const checkbox = li.querySelector(
        ':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]'
      )
      const box = checkbox ? (checkbox.hasAttribute('checked') ? '[x] ' : '[ ] ') : ''

      const [head = '', ...rest] = trimBlank(childLines(li))
      lines.push(marker + box + head)

      const indent = ' '.repeat(marker.length)
      for (const line of trimBlank(rest)) lines.push(line ? indent + line : '')
    }

    lines.push('')
    return lines
  }

  function tableLines(el) {
    const rows = []
    for (const tr of el.querySelectorAll('tr')) {
      if (tr.closest('table') !== el) continue // 入れ子のテーブルの行は内側で処理する
      const cells = []
      for (const cell of tr.children) {
        if (cell.tagName !== 'TD' && cell.tagName !== 'TH') continue
        cells.push(
          inlineChildren(cell)
            .trim()
            .replace(/\|/g, '\\|')
            // セル内の改行をそのまま出すと表が途中で終わってしまう
            .replace(/\s*\n\s*/g, '<br>')
        )
      }
      if (cells.length) rows.push(cells)
    }
    if (!rows.length) return []

    return [
      `| ${rows[0].join(' | ')} |`,
      `|${'---|'.repeat(rows[0].length)}`,
      ...rows.slice(1).map((cells) => `| ${cells.join(' | ')} |`),
      '',
    ]
  }

  function blockLines(el) {
    const tag = el.tagName
    if (/^H[1-6]$/.test(tag)) {
      const text = inlineChildren(el).trim()
      return text ? ['#'.repeat(Number(tag[1])) + ' ' + text, ''] : []
    }

    switch (tag) {
      case 'P': {
        const text = inlineChildren(el).trim()
        return text ? [text, ''] : []
      }
      case 'PRE':
        return codeBlockLines(el)
      case 'UL':
      case 'OL':
        return listLines(el)
      case 'TABLE':
        return tableLines(el)
      case 'HR':
        return ['---', '']
      case 'BLOCKQUOTE':
        return [...trimBlank(childLines(el)).map((line) => (line ? `> ${line}` : '>')), '']
      // <details> は既定処理で中身を展開し、<summary> だけ見出し代わりに強調する
      case 'SUMMARY': {
        const text = inlineChildren(el).trim()
        return text ? [`**${text}**`, ''] : []
      }
      default:
        return childLines(el)
    }
  }

  function htmlToMarkdown(el) {
    const lines = []
    for (const line of childLines(el)) {
      if (!line.trim() && lines.length && !lines[lines.length - 1].trim()) continue
      lines.push(line.replace(/\s+$/, ''))
    }
    return trimBlank(lines).join('\n')
  }

  // ------------------------------------------------------------------ 組み立て

  function readPullRequest(doc) {
    // react-app の app-name は "pull-requests" から "repo" へ変わった実績があるため、
    // 属性で絞らず、埋め込み JSON の中身で PR のものを見分ける
    let route
    for (const script of doc.querySelectorAll('script[data-target="react-app.embeddedData"]')) {
      try {
        route = JSON.parse(script.textContent)?.payload?.pullRequestsLayoutRoute
      } catch {
        // 埋め込み JSON の形式変更も DOM 変更と同じ扱いにする
      }
      if (route) break
    }
    const pullRequest = route?.pullRequest
    // 存在確認だけでは、フィールド名が変わったときに undefined を黙ってコピーしてしまう
    if (!pullRequest?.title || !pullRequest.baseBranch || !pullRequest.headBranch) {
      throw new Error(DOM_CHANGED)
    }
    return { pullRequest, baseOwner: route.repository?.ownerLogin }
  }

  function buildSummary(doc, url) {
    const { pullRequest, baseOwner } = readPullRequest(doc)

    const headOwner = pullRequest.headRepositoryOwnerLogin
    // fork からの PR は GitHub の表示に合わせて owner:branch とする
    const head =
      headOwner && headOwner !== baseOwner
        ? `${headOwner}:${pullRequest.headBranch}`
        : pullRequest.headBranch

    // 取得できなければ諦める。緩いセレクタで代用すると他人のコメントを
    // Description として黙ってコピーしてしまう。
    const body = doc.querySelector('.js-command-palette-pull-body .comment-body.markdown-body')
    if (!body) throw new Error(DOM_CHANGED)

    return [
      `# ${pullRequest.title}`,
      '',
      url,
      '',
      `\`${head}\` → \`${pullRequest.baseBranch}\``,
      '',
      '## Description',
      '',
      htmlToMarkdown(body),
      '',
    ].join('\n')
  }

  // -------------------------------------------------------------- 付随ユーティリティ

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      console.warn('[Copy PR Summary] Clipboard API が使えないため代替手段を試します', error)
    }

    // execCommand は選択範囲を要求するので、ユーザーの選択を退避してから復元する
    const selection = window.getSelection()
    const ranges = []
    for (let i = 0; i < (selection?.rangeCount ?? 0); i += 1) ranges.push(selection.getRangeAt(i))

    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()

    selection?.removeAllRanges()
    for (const range of ranges) selection.addRange(range)

    if (!copied) throw new Error('クリップボードへの書き込みに失敗しました')
  }

  function toast(message, isError = false) {
    document.getElementById(TOAST_ID)?.remove()

    const el = document.createElement('div')
    el.id = TOAST_ID
    el.textContent = message
    el.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      'max-width:360px',
      'padding:10px 14px',
      'border-radius:6px',
      'font:500 13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'color:#ffffff',
      `background:${isError ? '#cf222e' : '#1f2328'}`,
      'box-shadow:0 4px 12px rgba(0,0,0,.3)',
      'pointer-events:none',
    ].join(';')

    document.body.appendChild(el)
    setTimeout(() => el.remove(), TOAST_DURATION_MS)
  }

  // ---------------------------------------------------------------------- main

  const match = location.pathname.match(PR_PATH)
  if (!match) {
    toast('Pull Request のページではありません', true)
    return
  }
  const [, owner, repo, number] = match
  const url = `${location.origin}/${owner}/${repo}/pull/${number}`

  try {
    // どのタブから実行されても同じ結果になるよう、常に Conversation ページを取得する
    const response = await fetch(url, { credentials: 'same-origin' })
    if (!response.ok) {
      throw new Error(`Pull Request の取得に失敗しました (HTTP ${response.status})`)
    }
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html')
    await copyText(buildSummary(doc, url))
    toast('Pull Request概要をコピーしました')
  } catch (error) {
    console.error('[Copy PR Summary]', error)
    toast(error.message || 'コピーに失敗しました', true)
  }
})()
