import { xmlEscape } from './util.js'

import type { FeedOptions, PageRecord, ResolvedOptions } from './types.js'

/**
 * Atom 1.0 のフィードを作る。
 *
 * **全文は入れない。** 概要と URL だけにして、本文は取りに来てもらう。
 * 全文を配ると、どこが最新の版かが分からなくなる（フィードの複製が残り続ける）。
 */
export function renderFeed(o: ResolvedOptions, feed: FeedOptions, records: PageRecord[]): string {
  const patterns = (Array.isArray(feed.pattern) ? feed.pattern : [feed.pattern]).map(globToRegExp)
  // **ソースのパスで照合する。** `rewrites` を使っているサイトでは
  // `relativePath` が付け替え後になり、`posts/**/*.md` が1件も当たらない
  // （blog で実際にフィードが空になった）。両方見て、どちらかが当たれば拾う。
  const entries = records
    .filter((r) => r.date && patterns.some((re) => re.test(r.sourceRelative ?? r.relativePath) || re.test(r.relativePath)))
    .sort((a, b) => (a.date! < b.date! ? 1 : -1))
    .slice(0, feed.limit ?? 50)

  const updated = entries[0]?.updated ?? entries[0]?.date ?? new Date(0).toISOString()
  const self = `${o.origin}${feed.path ?? '/feed.xml'}`

  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${xmlEscape(feed.title ?? o.siteName ?? o.origin)}</title>`,
    feed.description ? `  <subtitle>${xmlEscape(feed.description)}</subtitle>` : '',
    `  <id>${xmlEscape(`${o.origin}/`)}</id>`,
    `  <link rel="alternate" type="text/html" href="${xmlEscape(`${o.origin}/`)}"/>`,
    `  <link rel="self" type="application/atom+xml" href="${xmlEscape(self)}"/>`,
    `  <updated>${updated}</updated>`,
  ].filter(Boolean)

  for (const e of entries) {
    const url = `${o.origin}/${e.route}`
    lines.push('  <entry>')
    lines.push(`    <title>${xmlEscape(e.title ?? e.route)}</title>`)
    lines.push(`    <id>${xmlEscape(url)}</id>`)
    lines.push(`    <link rel="alternate" type="text/html" href="${xmlEscape(url)}"/>`)
    lines.push(`    <published>${e.date}</published>`)
    lines.push(`    <updated>${e.updated ?? e.date}</updated>`)
    if (e.description) lines.push(`    <summary type="text">${xmlEscape(e.description)}</summary>`)
    lines.push('  </entry>')
  }

  lines.push('</feed>', '')
  return lines.join('\n')
}

/** `posts/**\/*.md` 程度の指定を扱えれば足りる */
export function globToRegExp(glob: string): RegExp {
  const src = glob
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) => {
      if (part === '**/') return '(?:.*/)?'
      if (part === '**') return '.*'
      if (part === '*') return '[^/]*'
      if (part === '?') return '[^/]'
      return part.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  return new RegExp(`^${src}$`)
}
