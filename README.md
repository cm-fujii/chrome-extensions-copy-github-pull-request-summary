# chrome-extensions-copy-github-pull-request-summary

GitHub の Pull Request ページで右クリックし、「Pull Request概要コピー」を選ぶと、
PR の URL・タイトル・ブランチ・Description を Markdown 形式でクリップボードにコピーする Chrome 拡張機能です。

## 出力例

````markdown
# Apply `font-variation-settings` to the suggestion widget

https://github.com/microsoft/vscode/pull/200000

`chengluyu:fix/font-variation-settings` → `main`

## Description

## 背景

詳細は [RFC](https://example.com/rfc) を参照。

- [x] Google プロバイダ対応
- [ ] GitHub プロバイダ

```ts
const token = await refresh()
```
````

- fork からの PR は GitHub の表示に合わせて `owner:branch` と表記します
- Description は見出し・リスト・タスクリスト・コードブロック・リンク・表・引用などを Markdown に復元します

## 導入手順

1. このリポジトリを clone する
2. Chrome で `chrome://extensions` を開く
3. 右上の「デベロッパー モード」をオンにする
4. 「パッケージ化されていない拡張機能を読み込む」でこのリポジトリのディレクトリを選ぶ

## 使い方

GitHub の Pull Request のページ（Conversation / Commits / Files changed / Checks のどのタブでも可）で
右クリックし、「Pull Request概要コピー」を選びます。コピーの成否は画面右下にトーストで表示されます。

## 仕組み

- 右クリック時にのみ `content.js` を注入する構成で、常駐する content script はありません
- どのタブから実行しても同じ結果になるよう、常に Conversation ページを `fetch` して情報を取り出します
- タイトル・ブランチは、GitHub がページに埋め込んでいる JSON
  （`react-app[app-name="pull-requests"]` 内の `embeddedData`）から取得します。
  CSS クラス名に依存しないため、GitHub の画面変更に比較的強い経路です
- Description はレンダリング済み HTML を Markdown に変換します
  （生の Markdown は編集権限がある場合しか DOM に出ないため）。
  こちらは `.js-command-palette-pull-body .comment-body.markdown-body` という
  CSS クラスに依存するため、GitHub の画面変更で壊れる可能性があります。
  取得できなかった場合は、誤った内容をコピーせずエラーとして扱います

## 権限

| 権限 | 用途 |
| --- | --- |
| `contextMenus` | 右クリックメニューの追加 |
| `scripting` | メニュー選択時の `content.js` 注入 |
| `clipboardWrite` | クリップボードへの書き込み |
| `https://github.com/*` | PR ページの取得 |

## テスト

ヘッドレス Chrome の実 DOM 上で `content.js` を動かし、コピー結果を検証します。

```sh
python3 test/e2e.py

# Chrome が /Applications 以外にある場合
CHROME=/path/to/chrome python3 test/e2e.py
```

`test/fixture-*.html` が GitHub の PR ページ、`test/expected-*.md` が期待するコピー結果です。
検証している内容は各フィクスチャの先頭コメントに記載しています。

## 制限事項

- 対応は `github.com` のみです。GitHub Enterprise では動作しません
- Description の変換は主要な Markdown 記法が対象です。脚注や数式などは平文になります
