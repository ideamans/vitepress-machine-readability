/** JSON-LD の Organization。サイト共通の発行者を1箇所で決める */
export interface Organization {
  name: string
  url: string
  /** 絶対URL、またはサイトルートからの絶対パス */
  logo?: string
  sameAs?: string[]
}

/**
 * frontmatter のキー名の差を吸収する表。
 *
 * サイトごとに `description` / `excerpt` / `lead` と割れているのが普通なので、
 * **サイト側の Markdown を書き換えずに** ここで寄せる。先に見つかったキーを使う。
 */
export interface FieldMap {
  /** 既定: ['description', 'excerpt', 'lead', 'summary'] */
  description?: string[]
  /** 既定: ['date', 'publishedAt', 'created'] */
  date?: string[]
  /** 既定: ['updated', 'updatedAt', 'lastUpdated'] */
  updated?: string[]
  /** 既定: ['image', 'ogImage', 'cover', 'thumbnail'] */
  image?: string[]
}

export type LintLevel = 'off' | 'warn' | 'error'

export interface LintOptions {
  /** 既定 'warn'。'error' にするとビルドが落ちる */
  level?: LintLevel
  /** チェックIDごとの上書き。例 `{ 'L2-16': 'off' }` */
  rules?: Record<string, LintLevel>
  /** 検査しないパス。`dist` からの相対パスの前方一致 */
  exclude?: string[]
  /** 1ルールあたり報告する件数の上限。既定 10 */
  maxReported?: number
}

export interface RobotsOptions {
  /** 生成AIのクローラを明示的に許可する。既定 true */
  aiCrawlers?: boolean
  /** 末尾に足す行 */
  extra?: string
  /** すでに robots.txt がある場合。既定 'overwrite' */
  existing?: 'overwrite' | 'keep'
}

export interface FeedOptions {
  /** 配信パス。既定 '/feed.xml' */
  path?: string
  /** 記事を集める glob。`createContentLoader` にそのまま渡す */
  pattern: string | string[]
  title?: string
  description?: string
  /** 既定 50 */
  limit?: number
  /** 同じ内容を別のパスにも置く。例 `['/atom.xml']`（購読者を切らないため） */
  alias?: string[]
}

export interface MachineReadabilityOptions {
  /** 例 'https://blog.ideamans.com/'。末尾のスラッシュは有無どちらでもよい */
  hostname: string
  /** JSON-LD の発行者。`false` で出さない */
  organization?: Organization | false
  /** og:site_name。既定はサイト設定の title */
  siteName?: string
  /** og:locale。既定 'ja_JP' */
  locale?: string
  /** og:image の既定値。ページ個別の指定が無いときに使う */
  defaultImage?: string
  twitter?: { site?: string; card?: 'summary' | 'summary_large_image' }
  map?: FieldMap
  /**
   * sitemap の `<lastmod>`。既定 'auto'（frontmatter → git → ファイルの更新時刻）。
   *
   * **ビルド時刻は使わない。** 使うと毎回全URLが更新扱いになり lastmod の意味が消える。
   */
  sitemapLastmod?: 'auto' | 'frontmatter' | 'git' | 'off'
  /** robots.txt を書き出す。既定 true */
  robots?: boolean | RobotsOptions
  /** フィードを書き出す。既定は出さない（記事サイトだけ指定する） */
  feed?: FeedOptions | false
  /** 各ページの Markdown 原本を `<route>.md` として一緒に配る。既定 false */
  markdownSource?: boolean
  /**
   * frontmatter に日付が無いページで、git の最終コミット日時を更新日として出す。既定 true
   *
   * **公開日は捏造しない。** 出すのは更新日だけ。
   */
  dateFallback?: boolean
  /**
   * ページ固有の説明文が無いとき、本文の冒頭の段落から起こす。既定 false
   *
   * **要約を作文するのではなく、著者が書いた最初の段落を抜き出すだけ。**
   * 説明文が「短い」のを直す用途ではない（そちらは人が書く）。
   * サイト共通の説明文が全ページに出ている状態を抜けるための道具。
   */
  descriptionFallback?: false | { chars?: number }
  /** JSON-LD の BreadcrumbList を出す。既定 true */
  breadcrumb?: boolean
  /** ビルド時の検査。既定 'warn' */
  lint?: LintLevel | LintOptions
}

/** 解決済みの設定。内部で使う */
export interface ResolvedOptions {
  hostname: string
  origin: string
  organization: Organization | false
  siteName: string | undefined
  locale: string
  defaultImage: string | undefined
  twitter: { site?: string; card: 'summary' | 'summary_large_image' }
  map: Required<FieldMap>
  sitemapLastmod: 'auto' | 'frontmatter' | 'git' | 'off'
  robots: RobotsOptions | false
  feed: FeedOptions | false
  markdownSource: boolean
  descriptionFallback: false | { chars: number }
  dateFallback: boolean
  breadcrumb: boolean
  lint: { level: LintLevel; rules: Record<string, LintLevel>; exclude: string[]; maxReported: number }
}

/** ページ1枚の素性。transformPageData で集めて、あとの工程で使い回す */
export interface PageRecord {
  /** frontmatter を map で寄せたあとの値 */
  route: string
  relativePath: string
  /** srcDir から見たソースの相対パス。`rewrites` があると relativePath と食い違う */
  sourceRelative?: string
  filePath: string
  title?: string
  description?: string
  date?: string
  updated?: string
  /** frontmatter → git → ファイルの更新時刻 で決めた最終更新。sitemap と head で共用する */
  modified?: string
  image?: string
}
