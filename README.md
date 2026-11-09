# vitepress-machine-readability

VitePress サイトを、検索エンジンとAIの両方から読める状態にする。
canonical・OGP・JSON-LD・sitemap の `lastmod`・robots.txt・フィード・Markdown 原本を出し、
**ビルド時に出力そのものを検査する。**

```bash
npm i -D vitepress-machine-readability
```

```ts
// .vitepress/config.ts
import { defineConfig } from 'vitepress'
import { withMachineReadability } from 'vitepress-machine-readability'

export default defineConfig(
  withMachineReadability(
    {
      title: "ideaman's Blog",
      // 既存の設定はそのまま渡す。transformHead も buildEnd も潰さない
    },
    {
      hostname: 'https://blog.ideamans.com/',
      organization: { name: "ideaman's Inc.", url: 'https://www.ideamans.com/', logo: '/logo.svg' },
      map: { description: ['excerpt'] },
      feed: { pattern: 'posts/**/*.md' },
      lint: 'warn',
    }
  )
)
```

## なぜ設定を「包む」のか

**VitePress にプラグイン機構は無い。** `transformHead` も `buildEnd` も
設定に1つしか置けないので、素朴に足すと既存の実装を上書きして静かに壊す。
このパッケージは設定を包み、サイト側のフックを先に呼んでから自分の分を足す。

同じ理由で、**head はすでに出ているタグを出さない**。
自前で `og:title` を出しているサイトに入れても二重にならない。

## するべきことを、していないと気づけないから

速度と違って、機械可読性が壊れても誰も気づかない。
エージェントが黙って間違え、「なぜかうまく使えない」という形でしか症状が出ない。
だから**公開前に落とす**（このパッケージ）のと、**公開後に測る**のを両方やる。

## 出るもの

| 出力 | 説明 |
|---|---|
| `<link rel="canonical">` | 自ページの絶対URL |
| `og:*` / `twitter:*` | title・description・image・url・type・locale・site_name |
| `article:published_time` / `modified_time` | frontmatter の日付から |
| JSON-LD | `Organization`・`WebSite`（トップ）・`BlogPosting`（日付があるページ）・`BreadcrumbList` |
| `<meta name="description">` | **frontmatter のキー名の差を吸収して入れ直す**（後述） |
| `sitemap.xml` の `<lastmod>` | frontmatter → git → ファイルの更新時刻 |
| `robots.txt` | 生成AIのクローラを明示的に許可し、`Sitemap:` を持つ |
| `feed.xml` | Atom 1.0。要約のみ（全文は入れない） |
| `<route>.md` | Markdown の原本（`markdownSource: true`） |

### description のキー名がサイトごとに違う問題

`description` ではなく `excerpt` や `lead` で書いているサイトでは、
VitePress はそれに気づけず**サイト共通の説明文を全ページに出す**。
og だけ直しても `<meta name="description">` は共通のままなので、
`map.description` に書いたキーから `pageData` ごと入れ直す。

```ts
map: { description: ['excerpt', 'lead'] }
```

### 説明文がそもそも無いサイト

`descriptionFallback: {}` を付けると、ページ固有の説明文が無いページで
**本文の冒頭の段落を抜き出して**説明文にする。

```ts
descriptionFallback: { chars: 120 }
```

**要約を作文するのではない。** 著者が書いた最初の段落をそのまま使う。
こちらで要約を作ると、本文と食い違ったものが検索結果に出る。

効くのは「ページ固有の説明文がそもそも無い」サイト。そういうサイトでは
VitePress がサイト共通の説明文を全ページに出すので、**何百ページが
まったく同じ説明文**になる。説明文が短いのを直す用途ではない（それは人が書く）。

### 日付を持たないドキュメントにも更新日を出す

frontmatter に日付が無いページには、git の最終コミット日時を
`dateModified`（JSON-LD の `WebPage`）として出す。
情報がいつのものかを、AI が本文を読まずに判断できるようにするため。

**公開日は捏造しない。** 出すのは更新日だけ。`dateFallback: false` で止められる。

### sitemap の lastmod

**VitePress の `sitemap` は URL しか書かない。** 設定を入れただけで
満足していると、更新を伝えられないまま何年も過ぎる。

日付は frontmatter → git → ファイルの更新時刻の順に探す。
**ビルド時刻は使わない**（毎回すべてが更新扱いになり `lastmod` の意味が消える）。

`sitemap` の設定そのものが無いサイトには、`hostname` から自動で足す。

## ビルド時の検査

生成された `dist` の HTML を全ページ読んで検査する。
**設定ではなく出力を見る**のが要点で、MPA ではテーマのクライアント側の実装が
動かず「入れたつもりで出ていない」ことがある。

```
⚠ machine-readability  5 件（error 0 / warn 5）

  L1-7 h1 がちょうど1つ — 1 件
    /posts/2026/hello  h1 が 2 個
```

| ID | 見るもの |
|---|---|
| L1-4 | title が存在し、全ページで一意 |
| L1-5 | meta description が存在 |
| L1-6 | canonical が自ページを指す |
| L1-7 | h1 がちょうど1つ |
| L1-8 | `<html lang>` |
| L1-9 | 本文が HTML に入っている（300文字以上） |
| L1-10 | og:title / og:description / og:image |
| L1-11 | 公開日か更新日 |
| L2-16 | 画像の alt が**未設定**（`alt=""` は装飾画像の正しい指定なので数えない） |
| L2-20 | 見出しの階層が飛ばない |
| L2-21 | title が 15〜60 文字 |
| L2-22 | description が 60〜160 文字 |

```ts
lint: 'error'                                   // 1件でもあればビルドを落とす
lint: { level: 'error', rules: { 'L2-22': 'warn' } }  // 個別にゆるめる
lint: { exclude: ['tags/', '404.html'] }        // 検査しないパス
lint: 'off'
```

**最初から `error` にしない。** 既存サイトに入れると必ず落ちるので、
`warn` で全体像を見て、直しながら段階的に上げる。

指摘は1ルールにつき10件までしか出さない。直している最中に全部見たいときは
`MR_LINT_MAX=999 yarn build`。

## オプション

| | 既定 | |
|---|---|---|
| `hostname` | **必須** | `https://blog.example.com/` |
| `organization` | なし | JSON-LD の発行者 |
| `siteName` | サイト設定の `title` | `og:site_name` |
| `locale` | `'ja_JP'` | |
| `defaultImage` | なし | ページ個別指定が無いときの `og:image` |
| `twitter` | `{ card: 'summary_large_image' }` | |
| `map` | `description`/`excerpt`/`lead`/`summary` ほか | frontmatter のキー名の差を吸収 |
| `sitemapLastmod` | `'auto'` | `'frontmatter'` \| `'git'` \| `'off'` |
| `robots` | `true` | `{ aiCrawlers, extra, existing }` |
| `feed` | なし | `{ pattern, path, title, limit, alias }` |
| `markdownSource` | `false` | `<route>.md` を一緒に配る |
| `dateFallback` | `true` | 日付を持たないページに git の最終コミット日時を更新日として出す |
| `descriptionFallback` | `false` | ページ固有の説明文が無いとき、本文の冒頭の段落から起こす |
| `breadcrumb` | `true` | JSON-LD の `BreadcrumbList` |
| `lint` | `'warn'` | |

### robots.txt で明示するAIクローラ

`GPTBot` `OAI-SearchBot` `ChatGPT-User` `ClaudeBot` `Claude-User`
`PerplexityBot` `Google-Extended` `Applebot-Extended`

**`User-agent: *` では効かないものがある。** とくに `Google-Extended` は
検索のクロールと別のグループとして扱われるので、明示しないと
「許可しているつもり」で止まっていることに気づけない。
どれかを止めたくなったときも、書き換える場所が1つで済む。

### フィードのパスを変えたとき

`alias` に旧パスを書くと同じ内容をそこにも置く。購読者のリーダーを黙って
止めないために、しばらく両方配る。

```ts
feed: { pattern: 'posts/**/*.md', path: '/feed.xml', alias: ['/atom.xml'] }
```

## 実サイトに入れて分かったこと

17サイトへ入れる前に、性格の違う3サイト（VitePress 1.6 / 2.0-alpha、
MPA、自前の `transformHead`・`buildEnd` あり）で試した。そこで踏んだもの。

- **`rewrites` を使っているサイトでは `pageData.relativePath` が
  付け替え *後* のパスになる。** ソースの実ファイルは `pageData.filePath`
  から取らないと、更新日も Markdown 原本の配布も静かに落ちる
- **すでに `Article` があるページに `BlogPosting` を足さない。**
  下位型なので、両方あると1ページに実体が2つあることになる。
  同じ役割の型はまとめて1枠と数えている
- **`og:description` はサイト共通の説明文まで落とす。** 落とさないと
  「`<meta name="description">` はあるのに og だけ無い」という不揃いが残る
- **日本語のURLは canonical がパーセントエンコードされる。** 検査で
  ファイル名と素で比べると、タグページが全部「別のページを指している」になる
- **`alt=""` は「装飾画像なので読み飛ばして」という正しい指定。** 未設定と
  同じに数えると、テーマが出すロゴやアイコンで永久に警告が出続ける
- **一覧カードやサイドバーの見出しを `h3` にすると、`h1` の直後で階層が飛ぶ。**
  ページ見出しの直下の項目なので `h2` が正しい。1箇所直すと数百ページが直る

## 対応バージョン

VitePress `^1.6.0` と `^2.0.0-alpha.0`。MPA（`mpa: true`）でも動く。

## しないこと

- **本文の生成・書き換え**。説明文が短いからといって機械生成の要約で上書きしない
- **llms.txt の生成**。サイトの外に索引があるならそちらを配るほうが更新に追随する
- **速度改善**

## License

MIT © ideaman's Inc.

## リリース（メンテナー向け）

package.json の version を上げてコミットし、`git tag vX.Y.Z && git push origin vX.Y.Z`。
GitHub Actions が npm の Trusted Publishing（OIDC）で公開する（トークンは使わない）。
