import { resolveModified, routeKey } from './util.js'

import type { PageRecord, ResolvedOptions } from './types.js'

export interface SitemapItem {
  url: string
  lastmod?: number | string
  [k: string]: unknown
}

/**
 * sitemap の各URLに `<lastmod>` を足す。
 *
 * **VitePress の `sitemap` オプションは URL しか書かない。** 設定だけ入れて
 * 満足していると、更新を伝えられないまま何年も過ぎる。
 *
 * 日付の決め方は `resolveModified` に1本化してある。
 */
export function addLastmod(o: ResolvedOptions, items: SitemapItem[], registry: Map<string, PageRecord>): SitemapItem[] {
  if (o.sitemapLastmod === 'off') return items

  return items.map((item) => {
    if (item.lastmod) return item
    const rec = registry.get(routeKey(item.url))
    const lastmod = rec ? (rec.modified ?? resolveModified(o, rec)) : undefined
    return lastmod ? { ...item, lastmod } : item
  })
}
