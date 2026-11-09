# CLAUDE.md

VitePress サイトの機械可読性（検索エンジンとAIから見た読みやすさ）を足す npm パッケージ。

## このパッケージが解こうとしていること

速度と違って、機械可読性は壊れても誰も気づかない。エージェントが黙って間違え、
「なぜかうまく使えない」という形でしか症状が出ない。だから

- **公開前に落とす** — このパッケージの `lint`
- **公開後に測る** — `ideamans-media` の `/machine-readability-audit`

の両方をやる。**チェックIDは両者で共通**（`L1-4`、`L2-16` など）。
どちらで出た指摘も同じ話として扱えるように番号を揃えてあるので、
**片方だけIDを変えない**こと。基準の定義は
`ideamans-media/.claude/skills/machine-readability-audit/SKILL.md` が正。

## 設計で外せないところ

- **VitePress にプラグイン機構は無い。** `transformHead` も `buildEnd` も
  設定に1つしか置けない。だから「プラグイン」ではなく**設定を包む関数**にしてある。
  サイト側のフックを先に呼び、その返り値も「すでに出ているもの」として扱ってから
  自分の分を足す。この順序を崩すと、自前で og を出しているサイトで二重になる
- **`head` にすでにあるタグは出さない。** 17サイトへ入れる前提なので、
  黙って共存できることを最優先にしている
- **出力を見る。設定を見ない。** lint は `dist` の HTML を読む。MPA では
  テーマのクライアント側の実装が動かず「入れたつもりで出ていない」ことがある
- **`lastmod` にビルド時刻を使わない。** 毎回すべてが更新扱いになり意味が消える
- **`description` は `pageData` ごと入れ直す。** `og:description` だけ直しても
  `<meta name="description">` はサイト共通のままになる（実際に blog で
  全記事が同じ44文字になっていた）
- **ソースの実ファイルは `pageData.filePath`。** `relativePath` は `rewrites`
  適用 **後** のパスになることがある（blog の `monthly/2017-07.md` は
  `2017/07/index.md` として渡ってくる）。組み立てると存在しないファイルを指し、
  更新日が丸ごと落ちる
- **JSON-LD は「同じ役割の型」で1枠と数える。** `BlogPosting` は `Article` の
  下位型。型名の完全一致で見ると、両方あるページができる

## 構成

| ファイル | 役割 |
|---|---|
| `src/index.ts` | `withMachineReadability()`。フックの合流点 |
| `src/head.ts` | canonical / OGP / JSON-LD。**足りないものだけ返す** |
| `src/sitemap.ts` | `lastmod` |
| `src/robots.ts` | robots.txt と AI クローラの一覧 |
| `src/feed.ts` | Atom 1.0（要約のみ・全文は入れない） |
| `src/lint.ts` | `dist` の検査 |
| `src/html.ts` | HTML の読み取り（正規表現・パーサ不使用） |

## 開発

```bash
bun install
bun test                              # 単体
bun run build                         # dist（fixture が dist を参照するので先に）
npx vitepress build tests/fixture     # 結合。実際に出るものを目で見る
bun run typecheck
```

`tests/fixture` は**サイト側が自前の `transformHead` と `buildEnd` を
持っている状態**を再現している。ここが壊れると17サイトが壊れるので、
フックの合流に触ったら必ず結合まで回すこと。

## 変えたら揃えるもの

機能を足した・既定値を変えたときは、README（①）・`context7.json` の `rules`（③）・
この CLAUDE.md（③）を同時に直す。**①が古ければ人間が気づくが、③が古いことには
誰も気づかない。**

チェックIDを増やしたときは `ideamans-media` 側の `audit.mjs` と
`machine-readability-audit/SKILL.md` にも同じIDを足す。

## npm への公開

`v*` のタグを push すると `.github/workflows/publish.yml` がテストとビルドのあと npm に**そのまま公開する**
（承認待ちにしない）。認証は npm の Trusted Publishing（GitHub Actions の OIDC）で、`NPM_TOKEN` などのシークレットは使わない。
provenance は自動で付く。

```bash
# package.json の version を上げてコミット・push してから
git tag vX.Y.Z && git push origin vX.Y.Z
```

- タグと package.json の version が違えば落ちる。npm に同じ版があれば何もしない
- プレリリース（`1.2.0-beta.0`）は `latest` ではなく識別子の dist-tag（`beta`）で出る
- 手元から `npm publish` しない（トークンを置かない）
- タグを打ち直さずに出し直すときは、Actions の「Publish to npm」を workflow_dispatch で起動する（選んだブランチの package.json の版を出す）
- PR で `publish.yml` を変えると、公開せずにビルドと `npm pack --dry-run` までが走る
- package.json の `repository` はこのリポジトリを指すこと。provenance の検証で照合され、違うと公開が `E422` で落ちる（ワークフローが先に検査する）
- 前提: npmjs.com の `vitepress-machine-readability` の設定で、Trusted Publisher に GitHub Actions・`ideamans/vitepress-machine-readability`・`publish.yml`・権限 **publish** を登録してあること。
  stage publish の権限だけだと `npm publish` は `E403 OIDC permission denied` になる
