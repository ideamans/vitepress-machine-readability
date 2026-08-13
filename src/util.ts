import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { FieldMap, LintOptions, MachineReadabilityOptions, PageRecord, ResolvedOptions } from './types.js'

export const DEFAULT_MAP: Required<FieldMap> = {
  description: ['description', 'excerpt', 'lead', 'summary'],
  date: ['date', 'publishedAt', 'created'],
  updated: ['updated', 'updatedAt', 'lastUpdated'],
  image: ['image', 'ogImage', 'cover', 'thumbnail'],
}

export function resolveOptions(o: MachineReadabilityOptions): ResolvedOptions {
  if (!o.hostname) throw new Error('[machine-readability] hostname は必須です')

  const lint: LintOptions = typeof o.lint === 'string' ? { level: o.lint } : (o.lint ?? {})

  return {
    hostname: o.hostname,
    origin: new URL(o.hostname).origin,
    organization: o.organization ?? false,
    siteName: o.siteName,
    locale: o.locale ?? 'ja_JP',
    defaultImage: o.defaultImage,
    twitter: { site: o.twitter?.site, card: o.twitter?.card ?? 'summary_large_image' },
    map: { ...DEFAULT_MAP, ...o.map },
    sitemapLastmod: o.sitemapLastmod ?? 'auto',
    robots: o.robots === false ? false : { aiCrawlers: true, existing: 'overwrite', ...(typeof o.robots === 'object' ? o.robots : {}) },
    feed: o.feed ?? false,
    markdownSource: o.markdownSource ?? false,
    descriptionFallback: o.descriptionFallback ? { chars: o.descriptionFallback.chars ?? 120 } : false,
    dateFallback: o.dateFallback ?? true,
    breadcrumb: o.breadcrumb ?? true,
    lint: {
      level: lint.level ?? 'warn',
      rules: lint.rules ?? {},
      // 404 は検査しても直しようがないので既定で外す
      exclude: lint.exclude ?? ['404.html'],
      // 直している最中は全部見たい。MR_LINT_MAX=999 で上限を外す
      maxReported: Number(process.env.MR_LINT_MAX) || lint.maxReported || 10,
    },
  }
}

/** frontmatter から、表の順に最初に見つかった値を取る */
export function pick(fm: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!fm) return undefined
  for (const k of keys) {
    const v = fm[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (v instanceof Date) return v.toISOString()
  }
  return undefined
}

/**
 * `relativePath`（'posts/2025/10/foo.md'）から公開URLの経路を作る。
 *
 * sitemap の item.url と突き合わせるためのキーでもあるので、
 * **拡張子と index を落として同じ形に寄せる**のが要点。
 *
 * **`rewrites` を通すのを忘れない。** blog は `posts/:year/:month/:slug.md` を
 * `/:year/:month/:slug.html` に付け替えている。`relativePath` は付け替え前の
 * ままなので、素直に組み立てると canonical が実在しないURLを指す。
 */
export function routeOf(relativePath: string, cleanUrls: boolean, rewrites?: Record<string, string>): string {
  const rewritten = rewrites?.[relativePath] ?? relativePath
  const withoutExt = rewritten.replace(/\.md$/i, '')
  const route = cleanUrls ? withoutExt : `${withoutExt}.html`
  return route.replace(/(^|\/)index(\.html)?$/i, '$1')
}

/** item.url / route を比較できる形に正規化する */
export function routeKey(p: string): string {
  return p
    .replace(/^\/+/, '')
    .replace(/\.html$/i, '')
    .replace(/(^|\/)index$/i, '$1')
    .replace(/\/$/, '')
}

/** サイト内のパスを絶対URLにする。すでに絶対ならそのまま */
export function absoluteUrl(origin: string, p: string | undefined): string | undefined {
  if (!p) return undefined
  if (/^https?:\/\//i.test(p)) return p
  return `${origin}/${p.replace(/^\/+/, '')}`
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** ISO 8601 に寄せる。読めなければ undefined（**ビルド時刻で埋めない**） */
export function toIso(v: string | undefined): string | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/**
 * ディレクトリ配下の全ファイルの最終コミット日時を**1回の git 呼び出しで**作る。
 *
 * ページごとに `git log` を起動すると、記事が数百ある blog で
 * ビルドが目に見えて遅くなる。履歴を1度なめて表にする。
 */
const gitMaps = new Map<string, Map<string, string>>()

export function gitLastModified(file: string): string | undefined {
  const dir = path.dirname(file)
  const root = gitRoot(dir)
  if (!root) return undefined

  let map = gitMaps.get(root)
  if (!map) {
    map = buildGitMap(root)
    gitMaps.set(root, map)
  }
  return map.get(path.resolve(file))
}

function gitRoot(dir: string): string | undefined {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

function buildGitMap(root: string): Map<string, string> {
  const map = new Map<string, string>()
  try {
    const out = execFileSync('git', ['-C', root, 'log', '--format=%x00%aI', '--name-only', '--no-merges'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let date: string | undefined
    for (const line of out.split('\n')) {
      if (line.startsWith('\0')) {
        date = line.slice(1).trim()
        continue
      }
      const name = line.trim()
      // 履歴は新しい順なので、最初に出てきたものが最終更新
      if (name && date) {
        const abs = path.resolve(root, name)
        if (!map.has(abs)) map.set(abs, date)
      }
    }
  } catch {
    // git が無い環境でも壊れない
  }
  return map
}

/**
 * そのページの「最終更新」をひとつに決める。
 *
 * frontmatter → git → ファイルの更新時刻。**ビルド時刻は使わない。**
 * sitemap の `lastmod` と `article:modified_time` で同じ値を使うために、
 * ここに1本化してある（別々に決めると、同じページなのに日付が食い違う）。
 */
export function resolveModified(o: ResolvedOptions, rec: PageRecord): string | undefined {
  if (o.sitemapLastmod === 'off') return rec.updated ?? rec.date
  if (o.sitemapLastmod === 'frontmatter') return rec.updated ?? rec.date
  if (o.sitemapLastmod === 'git') return gitLastModified(rec.filePath)
  return rec.updated ?? rec.date ?? gitLastModified(rec.filePath) ?? fileMtime(rec.filePath)
}

export function fileMtime(file: string): string | undefined {
  try {
    return fs.statSync(file).mtime.toISOString()
  } catch {
    return undefined
  }
}

/** ディレクトリを再帰的に辿って条件に合うファイルを返す */
export function walk(dir: string, match: (p: string) => boolean, out: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) walk(p, match, out)
    else if (match(p)) out.push(p)
  }
  return out
}
