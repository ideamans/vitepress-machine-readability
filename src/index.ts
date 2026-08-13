import fs from 'node:fs'
import path from 'node:path'

import { excerptOf } from './excerpt.js'
import { buildHead, recordOf, type HeadConfig } from './head.js'
import { renderFeed } from './feed.js'
import { lintOutDir, reportFindings } from './lint.js'
import { renderRobots } from './robots.js'
import { addLastmod, type SitemapItem } from './sitemap.js'
import { resolveModified, resolveOptions, routeKey, routeOf } from './util.js'

import type { MachineReadabilityOptions, PageRecord } from './types.js'

export type { MachineReadabilityOptions, Organization, FieldMap, FeedOptions, LintOptions, LintLevel, RobotsOptions } from './types.js'
export { AI_CRAWLERS, renderRobots } from './robots.js'
export { parsePage } from './html.js'

/** VitePress 1.x / 2.x のどちらでも通るように、必要な形だけを構造的に見る */
interface LooseSiteConfig {
  outDir: string
  srcDir: string
  cleanUrls?: boolean
  /** `rewrites` の解決結果。`map` は「元のパス → 付け替え後のパス」 */
  rewrites?: { map?: Record<string, string> }
  site?: { title?: string; cleanUrls?: boolean }
}

interface LoosePageData {
  relativePath: string
  /** ソースの実ファイル。`rewrites` があると `relativePath` と一致しない */
  filePath?: string
  title?: string
  description?: string
  frontmatter?: Record<string, unknown>
  lastUpdated?: number
}

interface LooseConfig {
  cleanUrls?: boolean
  title?: string
  sitemap?: { hostname?: string; transformItems?: (items: SitemapItem[]) => SitemapItem[] | Promise<SitemapItem[]> } | undefined
  transformHead?: (ctx: {
    head: HeadConfig[]
    pageData: LoosePageData
    siteData?: { title?: string; description?: string }
    siteConfig?: LooseSiteConfig
  }) => unknown
  transformPageData?: (pageData: LoosePageData, ctx: { siteConfig: LooseSiteConfig }) => unknown
  buildEnd?: (siteConfig: LooseSiteConfig) => unknown
  [k: string]: unknown
}

/**
 * VitePress の設定を包んで、検索エンジンとAIから見た機械可読性を足す。
 *
 * VitePress にプラグイン機構は無く、`transformHead` も `buildEnd` も
 * **設定に1つしか置けない**。すでに自前の実装を持っているサイトが多いので、
 * 上書きせずに繋ぐ。出す head も「すでに出ているものは出さない」ので、
 * 二重に書かれることはない。
 *
 * ```ts
 * export default defineConfig(
 *   withMachineReadability(
 *     { title: "ideaman's Blog", transformHead: 自前のやつ },
 *     { hostname: 'https://blog.ideamans.com/', map: { description: ['excerpt'] } }
 *   )
 * )
 * ```
 */
export function withMachineReadability<T extends LooseConfig>(config: T, options: MachineReadabilityOptions): T {
  const o = resolveOptions(options)
  if (!o.siteName) o.siteName = config.title

  /** route をキーにしたページの素性。sitemap・フィード・.md の配布で使い回す */
  const registry = new Map<string, PageRecord>()

  const userTransformPageData = config.transformPageData
  const userTransformHead = config.transformHead
  const userBuildEnd = config.buildEnd
  const userSitemap = config.sitemap

  const out: LooseConfig = {
    ...config,

    // **sitemap の設定そのものが無いサイトには足す。**
    // hostname はこのオプションで既に分かっているので、書き忘れを起こさせない。
    sitemap: {
      hostname: userSitemap?.hostname ?? o.hostname,
      ...userSitemap,
      transformItems: async (items: SitemapItem[]) => {
        const base = userSitemap?.transformItems ? await userSitemap.transformItems(items) : items
        return addLastmod(o, base, registry)
      },
    },

    transformPageData: async (pageData: LoosePageData, ctx: { siteConfig: LooseSiteConfig }) => {
      const cleanUrls = ctx.siteConfig.cleanUrls ?? ctx.siteConfig.site?.cleanUrls ?? config.cleanUrls ?? false
      const rec = recordOf(o, pageData, ctx.siteConfig.srcDir, cleanUrls, ctx.siteConfig.rewrites?.map)
      // sitemap の lastmod と head の更新日で同じ値を使う。ここで1回だけ決める
      rec.modified = resolveModified(o, rec)
      registry.set(routeKey(rec.route), rec)

      const userResult = userTransformPageData ? await userTransformPageData(pageData, ctx) : undefined

      // **`description` をここで寄せる。**
      // frontmatter のキーが `excerpt` や `lead` だと、VitePress は気づけず
      // サイト共通の説明文を全ページに出してしまう。og だけ直しても
      // `<meta name="description">` は共通のままなので、pageData ごと直す。
      const merged = { ...(userResult as Record<string, unknown> | undefined) }
      const described = (merged.description as string | undefined) ?? pageData.description
      if (!described && rec.description) merged.description = rec.description

      // それでも無いなら本文の冒頭から起こす（有効にしたサイトだけ）
      if (!described && !merged.description && o.descriptionFallback) {
        const excerpt = excerptOf(rec.filePath, o.descriptionFallback.chars)
        if (excerpt) {
          merged.description = excerpt
          rec.description = excerpt
        }
      }

      return Object.keys(merged).length ? merged : undefined
    },

    transformHead: async (ctx) => {
      // 先にサイト側を動かし、その結果も「すでに出ているもの」として扱う。
      // こうしないと、自前で og:title を出しているサイトで二重になる。
      const userHead = normalizeHead(userTransformHead ? await userTransformHead(ctx) : undefined)
      const cleanUrls = ctx.siteConfig?.cleanUrls ?? ctx.siteConfig?.site?.cleanUrls ?? config.cleanUrls ?? false
      const ours = buildHead(o, {
        head: [...(ctx.head ?? []), ...userHead],
        pageData: ctx.pageData,
        siteData: ctx.siteData,
        cleanUrls,
        rewrites: ctx.siteConfig?.rewrites?.map,
        record: registry.get(routeKey(routeOf(ctx.pageData.relativePath, cleanUrls, ctx.siteConfig?.rewrites?.map))),
      })
      return [...userHead, ...ours]
    },

    buildEnd: async (siteConfig: LooseSiteConfig) => {
      if (userBuildEnd) await userBuildEnd(siteConfig)

      const outDir = siteConfig.outDir
      const records = [...registry.values()]

      if (o.robots) {
        const file = path.join(outDir, 'robots.txt')
        if (!(o.robots.existing === 'keep' && fs.existsSync(file))) {
          fs.writeFileSync(file, renderRobots(o.origin, o.robots))
        }
      }

      if (o.feed) {
        const xml = renderFeed(o, o.feed, records)
        for (const p of [o.feed.path ?? '/feed.xml', ...(o.feed.alias ?? [])]) {
          const file = path.join(outDir, p.replace(/^\/+/, ''))
          fs.mkdirSync(path.dirname(file), { recursive: true })
          fs.writeFileSync(file, xml)
        }
      }

      // **Markdown の原本も一緒に配る。** HTML から本文を復元させるより、
      // 書いたものをそのまま渡すほうが LLM にとって確実で安い。
      if (o.markdownSource) {
        for (const rec of records) {
          const src = rec.filePath
          if (!fs.existsSync(src)) continue
          const dest = path.join(outDir, `${rec.route === '' ? 'index' : rec.route.replace(/\.html$/i, '')}.md`)
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.copyFileSync(src, dest)
        }
      }

      const failed = reportFindings(o, lintOutDir(o, outDir, new Set(registry.keys())))
      if (failed) throw new Error('[machine-readability] Level 1 の検査に失敗しました。上の指摘を直してください。')
    },
  }

  return out as T
}

function normalizeHead(r: unknown): HeadConfig[] {
  if (!r) return []
  return (Array.isArray(r) ? r : [r]) as HeadConfig[]
}
