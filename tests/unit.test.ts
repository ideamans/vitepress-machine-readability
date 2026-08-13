import fs from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { renderFeed, globToRegExp } from '../src/feed.js'
import { buildHead, recordOf, type HeadConfig } from '../src/head.js'
import { parsePage, skipsHeadingLevel } from '../src/html.js'
import { lintOutDir } from '../src/lint.js'
import { renderRobots, AI_CRAWLERS } from '../src/robots.js'
import { addLastmod } from '../src/sitemap.js'
import { resolveOptions, routeKey, routeOf } from '../src/util.js'

const o = resolveOptions({
  hostname: 'https://blog.example.com/',
  siteName: 'Example Blog',
  organization: { name: 'Example Inc.', url: 'https://example.com/', logo: '/logo.svg' },
  defaultImage: '/ogp.png',
})

describe('route', () => {
  test('拡張子と index を落として同じ形に寄せる', () => {
    expect(routeOf('index.md', false)).toBe('')
    expect(routeOf('posts/2025/a.md', false)).toBe('posts/2025/a.html')
    expect(routeOf('posts/2025/a.md', true)).toBe('posts/2025/a')
    expect(routeOf('docs/index.md', false)).toBe('docs/')
  })

  test('sitemap の url とページの route が同じキーになる', () => {
    expect(routeKey('posts/2025/a.html')).toBe(routeKey('/posts/2025/a'))
    expect(routeKey('index.html')).toBe('')
    expect(routeKey('docs/index.html')).toBe('docs')
  })
})

describe('head', () => {
  const pageData = {
    relativePath: 'posts/2025/a.md',
    title: '画像最適化の実際',
    frontmatter: { excerpt: '実測してみた話', date: '2025-10-01' },
  }

  test('canonical・OGP・JSON-LD を出す', () => {
    const head = buildHead({ ...o, map: { ...o.map, description: ['excerpt'] } }, { head: [], pageData, cleanUrls: false })
    const canonical = head.find(([t, a]) => t === 'link' && a.rel === 'canonical')
    expect(canonical?.[1].href).toBe('https://blog.example.com/posts/2025/a.html')
    expect(head.find(([t, a]) => t === 'meta' && a.property === 'og:title')?.[1].content).toBe('画像最適化の実際')
    expect(head.find(([t, a]) => t === 'meta' && a.property === 'og:description')?.[1].content).toBe('実測してみた話')
    expect(head.find(([t, a]) => t === 'meta' && a.property === 'og:type')?.[1].content).toBe('article')

    const ld = head.find(([t, a]) => t === 'script' && a.type === 'application/ld+json')
    const graph = JSON.parse(String(ld?.[2]))['@graph'] as { '@type': string }[]
    expect(graph.map((g) => g['@type'])).toEqual(['Organization', 'BlogPosting', 'BreadcrumbList'])
  })

  test('すでに出ているタグは二重に出さない', () => {
    const existing: HeadConfig[] = [
      ['meta', { property: 'og:title', content: '自前のタイトル' }],
      ['link', { rel: 'canonical', href: 'https://blog.example.com/custom' }],
    ]
    const head = buildHead(o, { head: existing, pageData, cleanUrls: false })
    expect(head.some(([t, a]) => t === 'meta' && a.property === 'og:title')).toBe(false)
    expect(head.some(([t, a]) => t === 'link' && a.rel === 'canonical')).toBe(false)
    // 足りないものは出す
    expect(head.some(([t, a]) => t === 'meta' && a.property === 'og:description')).toBe(true)
  })

  test('日付が無いページは og:type が website で BlogPosting を作らない', () => {
    const head = buildHead(o, { head: [], pageData: { relativePath: 'about.md', title: 'このサイトについて' }, cleanUrls: false })
    expect(head.find(([t, a]) => t === 'meta' && a.property === 'og:type')?.[1].content).toBe('website')
    const ld = head.find(([t, a]) => t === 'script' && a.type === 'application/ld+json')
    expect(String(ld?.[2])).not.toContain('BlogPosting')
  })
})

describe('sitemap', () => {
  test('frontmatter の日付を lastmod にする', () => {
    const registry = new Map([
      ['posts/2025/a', { route: 'posts/2025/a.html', relativePath: 'posts/2025/a.md', filePath: '/nope/a.md', date: '2025-10-01T00:00:00.000Z', updated: '2026-01-05T00:00:00.000Z' }],
    ])
    const items = addLastmod(o, [{ url: 'posts/2025/a.html' }], registry)
    expect(items[0]?.lastmod).toBe('2026-01-05T00:00:00.000Z')
  })

  test('すでに lastmod があれば触らない', () => {
    const items = addLastmod(o, [{ url: 'x.html', lastmod: 'keep' }], new Map())
    expect(items[0]?.lastmod).toBe('keep')
  })
})

describe('robots', () => {
  test('AIクローラを明示し Sitemap 行を持つ', () => {
    const txt = renderRobots('https://blog.example.com', { aiCrawlers: true })
    for (const bot of AI_CRAWLERS) expect(txt).toContain(`User-agent: ${bot}`)
    expect(txt).toContain('Sitemap: https://blog.example.com/sitemap.xml')
  })
})

describe('feed', () => {
  test('パターンに合う記事だけを新しい順に入れる', () => {
    const records = [
      { route: 'posts/a.html', relativePath: 'posts/a.md', filePath: '', title: '古い', date: '2025-01-01T00:00:00.000Z' },
      { route: 'posts/b.html', relativePath: 'posts/b.md', filePath: '', title: '新しい', date: '2026-01-01T00:00:00.000Z' },
      { route: 'about.html', relativePath: 'about.md', filePath: '', title: '対象外', date: '2026-02-01T00:00:00.000Z' },
    ]
    const xml = renderFeed(o, { pattern: 'posts/**/*.md' }, records)
    expect(xml.indexOf('新しい')).toBeLessThan(xml.indexOf('古い'))
    expect(xml).not.toContain('対象外')
  })

  test('glob', () => {
    expect(globToRegExp('posts/**/*.md').test('posts/2025/10/a.md')).toBe(true)
    expect(globToRegExp('posts/**/*.md').test('posts/a.md')).toBe(true)
    expect(globToRegExp('posts/**/*.md').test('notes/a.md')).toBe(false)
  })
})

describe('html', () => {
  test('h1 と alt と日付を読む', () => {
    const p = parsePage(`<html lang="ja"><head><title>t</title></head><body>
      <h1>見出し</h1><h3>飛んでいる</h3>
      <img src="a.png" alt="ある"><img src="b.png">
      <time datetime="2026-01-01">2026-01-01</time>
      ${'本文'.repeat(200)}
    </body></html>`)
    expect(p.h1Count).toBe(1)
    expect(p.images).toBe(2)
    expect(p.imagesWithoutAlt).toBe(1)
    expect(p.hasDate).toBe(true)
    expect(p.lang).toBe('ja')
    expect(skipsHeadingLevel(p.headingLevels)).toBe(true)
  })
})

describe('lint', () => {
  test('dist を読んで指摘を出す', () => {
    const dir = `/tmp/mr-lint-${process.pid}`
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/index.html`, '<html><head><title>短い</title></head><body><h1>a</h1><h1>b</h1></body></html>')
    fs.writeFileSync(`${dir}/other.html`, '<html><head><title>短い</title></head><body></body></html>')

    const findings = lintOutDir(o, dir)
    const ids = new Set(findings.map((f) => f.id))
    expect(ids.has('L1-4')).toBe(true) // title が2ページで重複
    expect(ids.has('L1-7')).toBe(true) // h1 が2個
    expect(ids.has('L1-8')).toBe(true) // lang なし
    expect(ids.has('L2-21')).toBe(true) // title が短い
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

// ---- ここから下は、実サイトに入れて見つかった不具合の回帰テスト ----

describe('実地で見つかった不具合', () => {
  test('rewrites があるとき relativePath からソースの実ファイルを組み立てない', () => {
    // blog: monthly/2017-07.md が 2017/07/index.md として渡ってくる。
    // 組み立てると存在しないファイルを指し、更新日が丸ごと落ちる
    const rec = recordOf(
      o,
      { relativePath: '2017/07/index.md', filePath: 'monthly/2017-07.md', title: 'monthly' },
      '/site',
      false
    )
    expect(rec.filePath).toBe('/site/monthly/2017-07.md')
    expect(rec.route).toBe('2017/07/')
  })

  test('すでに Article があるページに BlogPosting を重ねない', () => {
    const existing: HeadConfig[] = [
      ['script', { type: 'application/ld+json' }, JSON.stringify({ '@type': 'Article', headline: 'x' })],
    ]
    const head = buildHead(o, {
      head: existing,
      pageData: { relativePath: 'posts/a.md', title: 'あ', frontmatter: { date: '2026-01-01' } },
      cleanUrls: false,
    })
    const ld = head.find(([t, a]) => t === 'script' && a.type === 'application/ld+json')
    expect(String(ld?.[2] ?? '')).not.toContain('BlogPosting')
  })

  test('日本語URLの canonical を誤判定しない', () => {
    const dir = `/tmp/mr-lint-jp-${process.pid}`
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(`${dir}/tags`, { recursive: true })
    // canonical はパーセントエンコード、ファイル名は生のUTF-8になる
    fs.writeFileSync(
      `${dir}/tags/css最適化.html`,
      '<html lang="ja"><head><title>タグ: CSS最適化 | サイト</title>' +
        '<link rel="canonical" href="https://blog.example.com/tags/css%E6%9C%80%E9%81%A9%E5%8C%96.html">' +
        '</head><body></body></html>'
    )
    const findings = lintOutDir(o, dir)
    expect(findings.filter((f) => f.id === 'L1-6')).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('フィードとソースのパス', () => {
  test('rewrites があっても pattern が当たる', () => {
    // blog: posts/2026/a.md が 2026/a.md として渡ってくる
    const records = [
      { route: '2026/a.html', relativePath: '2026/a.md', sourceRelative: 'posts/2026/a.md', filePath: '', title: '記事', date: '2026-01-01T00:00:00.000Z' },
    ]
    const xml = renderFeed(o, { pattern: 'posts/**/*.md' }, records)
    expect(xml).toContain('<entry>')
    expect(xml).toContain('記事')
  })
})
