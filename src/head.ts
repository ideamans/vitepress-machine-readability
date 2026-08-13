import { absoluteUrl, pick, routeOf, toIso } from './util.js'

import type { PageRecord, ResolvedOptions } from './types.js'

/** VitePress の HeadConfig。1.x と 2.x のどちらでも通る形にしておく */
export type HeadConfig = [string, Record<string, string>] | [string, Record<string, string>, string]

/**
 * すでに出ている head を見て、**足りないものだけ**を返す。
 *
 * 17サイトのうち多くは自前の `transformHead` を持っている。
 * 上書きも二重出力もせず、黙って共存できることを最優先にしている。
 */
export function buildHead(
  o: ResolvedOptions,
  ctx: {
    head: HeadConfig[]
    pageData: { relativePath: string; title?: string; description?: string; frontmatter?: Record<string, unknown>; lastUpdated?: number }
    siteData?: { title?: string; description?: string; cleanUrls?: boolean; lang?: string }
    cleanUrls: boolean
    rewrites?: Record<string, string>
    /** transformPageData で集めた素性。git 由来の更新日を持っている */
    record?: PageRecord
  }
): HeadConfig[] {
  const { pageData, head } = ctx
  const fm = pageData.frontmatter ?? {}
  const out: HeadConfig[] = []

  const route = routeOf(pageData.relativePath, ctx.cleanUrls, ctx.rewrites)
  const url = `${o.origin}/${route}`
  const isHome = route === ''

  const title = pageData.title || (typeof fm.title === 'string' ? fm.title : undefined) || o.siteName || ctx.siteData?.title

  // **og:description はサイト共通の説明文まで落とす。**
  // VitePress は `<meta name="description">` を同じように埋めるので、
  // ここで落とさないと「meta はあるのに og だけ無い」という不揃いが残る。
  const description = pageData.description || pick(fm, o.map.description) || ctx.siteData?.description

  const image = absoluteUrl(o.origin, pick(fm, o.map.image) ?? o.defaultImage)
  const published = toIso(pick(fm, o.map.date))

  // **日付を持たないドキュメントサイトでも更新日は出せる。**
  // git の最終コミット日時は事実なので、これを `modified` として出す。
  // `published` は捏造しない（無いものは無い）。
  const updated =
    toIso(pick(fm, o.map.updated)) ??
    (pageData.lastUpdated ? new Date(pageData.lastUpdated).toISOString() : undefined) ??
    (o.dateFallback ? ctx.record?.modified : undefined)

  const add = (tag: HeadConfig) => out.push(tag)
  const meta = (kind: 'property' | 'name', key: string, content: string | undefined) => {
    if (!content) return
    if (hasMeta(head, kind, key) || hasMeta(out, kind, key)) return
    add(['meta', { [kind]: key, content }])
  }

  // --- canonical (L1-6)
  if (!hasLink(head, 'canonical')) add(['link', { rel: 'canonical', href: url }])

  // --- OGP (L1-10)
  meta('property', 'og:title', title)
  meta('property', 'og:description', description)
  meta('property', 'og:image', image)
  meta('property', 'og:url', url)
  meta('property', 'og:type', published ? 'article' : 'website')
  meta('property', 'og:locale', o.locale)
  meta('property', 'og:site_name', o.siteName ?? ctx.siteData?.title)

  // --- 公開日・更新日 (L1-11)
  if (published) {
    meta('property', 'article:published_time', published)
    meta('property', 'article:modified_time', updated ?? published)
  }

  // --- Twitter
  meta('name', 'twitter:card', o.twitter.card)
  meta('name', 'twitter:site', o.twitter.site)
  meta('name', 'twitter:image', image)

  // --- JSON-LD
  const graph: Record<string, unknown>[] = []

  if (o.organization) {
    graph.push({
      '@type': 'Organization',
      '@id': `${o.organization.url.replace(/\/$/, '')}/#organization`,
      name: o.organization.name,
      url: o.organization.url,
      ...(o.organization.logo ? { logo: absoluteUrl(o.origin, o.organization.logo) } : {}),
      ...(o.organization.sameAs?.length ? { sameAs: o.organization.sameAs } : {}),
    })
  }

  if (isHome) {
    graph.push({
      '@type': 'WebSite',
      '@id': `${o.origin}/#website`,
      url: `${o.origin}/`,
      name: o.siteName ?? ctx.siteData?.title ?? title,
      ...(description ? { description } : {}),
      ...(o.organization ? { publisher: { '@id': `${o.organization.url.replace(/\/$/, '')}/#organization` } } : {}),
    })
  }

  if (published) {
    graph.push({
      '@type': 'BlogPosting',
      '@id': `${url}#article`,
      headline: title,
      url,
      mainEntityOfPage: url,
      datePublished: published,
      dateModified: updated ?? published,
      ...(description ? { description } : {}),
      ...(image ? { image } : {}),
      ...(o.organization ? { publisher: { '@id': `${o.organization.url.replace(/\/$/, '')}/#organization` } } : {}),
    })
  }

  // 記事ではないページ（日付を持たないドキュメント）も、更新日は出せる。
  // 情報がいつのものかを、AI が本文を読まずに判断できるようにするため。
  //
  // **日付がどこにも無いなら、枠が埋まっていても出す。** サイトが自前で
  // `FAQPage` を出していると WebPage の枠は埋まっているが、そこに日付が
  // 無ければページの新しさは分からないままになる（rehearsal で実際にそうだった）。
  if (!published && updated) {
    graph.push({
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: title,
      dateModified: updated,
      ...(description ? { description } : {}),
      ...(o.organization ? { publisher: { '@id': `${o.organization.url.replace(/\/$/, '')}/#organization` } } : {}),
    })
  }

  if (o.breadcrumb && !isHome) {
    const crumbs = breadcrumbOf(o, route, title)
    if (crumbs.length > 1) graph.push(breadcrumbList(crumbs))
  }

  // **すでに出ている型は出さない。** 自前で Article を出しているサイトに
  // もう1つ Article を足すと、どちらが正か機械には決められない。
  // 「JSON-LD が1つでもあれば全部やめる」にすると、
  // 日付だけ足したいページに何も入らなくなるので、型ごとに見る。
  //
  // **同じ役割の型はまとめて1枠と数える。** `BlogPosting` は `Article` の
  // 下位型なので、両方あると1ページに実体が2つあることになる。
  const already = existingLdTypes(head)
  const hasDateSignal = headHasDate(head)
  const fresh = graph.filter((node) => {
    const type = String(node['@type'])
    // 日付を運ぶためだけの WebPage は、枠が埋まっていても日付が無いなら出す。
    // 記事（BlogPosting）は別。すでに Article があるページに重ねない
    if (type === 'WebPage' && !hasDateSignal) return true
    return !occupies(already, type)
  })
  if (fresh.length) {
    add(['script', { type: 'application/ld+json' }, JSON.stringify({ '@context': 'https://schema.org', '@graph': fresh })])
  }

  return out
}

function breadcrumbOf(o: ResolvedOptions, route: string, title: string | undefined) {
  const segments = route.replace(/\.html$/i, '').split('/').filter(Boolean)
  const items: { name: string; url: string }[] = [{ name: o.siteName ?? 'Home', url: `${o.origin}/` }]
  let acc = ''
  segments.forEach((seg, i) => {
    acc += `${seg}/`
    const last = i === segments.length - 1
    items.push({ name: last && title ? title : deslug(seg), url: `${o.origin}/${last ? route : acc}` })
  })
  return items
}

function breadcrumbList(items: { name: string; url: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  }
}

/** 'core-web-vitals' → 'Core Web Vitals' 相当。日本語はそのまま */
function deslug(s: string): string {
  const t = decodeURIComponent(s).replace(/[-_]+/g, ' ').trim()
  return t.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

function hasMeta(head: HeadConfig[], kind: 'property' | 'name', key: string): boolean {
  return head.some(([tag, attrs]) => tag === 'meta' && attrs?.[kind] === key)
}

function hasLink(head: HeadConfig[], rel: string): boolean {
  return head.some(([tag, attrs]) => tag === 'link' && attrs?.rel === rel)
}

/**
 * 同じ役割の型のまとまり。どれか1つが出ていれば、その枠は埋まっているとみなす。
 */
const TYPE_GROUPS: string[][] = [
  ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'ScholarlyArticle', 'Report'],
  ['WebPage', 'CollectionPage', 'ItemPage', 'AboutPage', 'ContactPage', 'ProfilePage', 'FAQPage', 'QAPage'],
]

function occupies(already: Set<string>, type: string): boolean {
  if (already.has(type)) return true
  const group = TYPE_GROUPS.find((g) => g.includes(type))
  return group ? group.some((t) => already.has(t)) : false
}

/** すでに日付が出ているか。JSON-LD の date* か OGP の article:*_time */
function headHasDate(head: HeadConfig[]): boolean {
  return head.some((entry) => {
    const [tag, attrs, body] = entry
    if (tag === 'meta' && /^article:(published|modified)_time$/.test(String(attrs?.property ?? ''))) return true
    if (tag === 'script' && attrs?.type === 'application/ld+json' && body) {
      return /"date(Published|Modified)"\s*:/.test(String(body))
    }
    return false
  })
}

/** すでに出ている JSON-LD の @type を集める。読めないものは無視する */
function existingLdTypes(head: HeadConfig[]): Set<string> {
  const types = new Set<string>()
  for (const entry of head) {
    const [tag, attrs, body] = entry
    if (tag !== 'script' || attrs?.type !== 'application/ld+json' || !body) continue
    for (const m of String(body).matchAll(/"@type"\s*:\s*"([^"]+)"/g)) {
      if (m[1]) types.add(m[1])
    }
  }
  return types
}

/** ソースの実ファイルの絶対パス。`filePath` があればそれを信じる */
function sourcePath(pageData: { relativePath: string; filePath?: string }, srcDir: string): string {
  const p = pageData.filePath || pageData.relativePath
  return p.startsWith('/') ? p : `${srcDir}/${p}`
}

/** transformPageData で集める1枚分の素性 */
export function recordOf(
  o: ResolvedOptions,
  pageData: { relativePath: string; filePath?: string; title?: string; description?: string; frontmatter?: Record<string, unknown>; lastUpdated?: number },
  srcDir: string,
  cleanUrls: boolean,
  rewrites?: Record<string, string>
): PageRecord {
  const fm = pageData.frontmatter ?? {}
  return {
    route: routeOf(pageData.relativePath, cleanUrls, rewrites),
    relativePath: pageData.relativePath,
    sourceRelative: (pageData.filePath || pageData.relativePath).replace(/^\/+/, ''),
    // **`relativePath` から実ファイルを組み立ててはいけない。**
    // `rewrites` を使っているサイトでは、これは付け替え **後** のパスになる。
    // blog の `monthly/2017-07.md` は `2017/07/index.md` として渡ってくるので、
    // 組み立てると存在しないファイルを指し、更新日が丸ごと落ちる。
    filePath: sourcePath(pageData, srcDir),
    title: pageData.title || (typeof fm.title === 'string' ? fm.title : undefined),
    description: pageData.description || pick(fm, o.map.description),
    date: toIso(pick(fm, o.map.date)),
    updated: toIso(pick(fm, o.map.updated)) ?? (pageData.lastUpdated ? new Date(pageData.lastUpdated).toISOString() : undefined),
    image: pick(fm, o.map.image),
  }
}
