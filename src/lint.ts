import fs from 'node:fs'
import path from 'node:path'

import { parsePage, skipsHeadingLevel } from './html.js'
import { routeKey, walk } from './util.js'

import type { LintLevel, ResolvedOptions } from './types.js'

/**
 * ビルドした `dist` を検査する。
 *
 * **公開後の点検（machine-readability-audit）と同じIDを使う。**
 * 向こうは公開されたサイトを標本で見る。こちらは公開前に全ページを見る。
 * 番号を揃えているのは、どちらで出た指摘も同じ話として扱えるようにするため。
 */
export interface Finding {
  id: string
  level: LintLevel
  page: string
  message: string
}

interface Rule {
  id: string
  name: string
  defaultLevel: LintLevel
}

const RULES: Rule[] = [
  { id: 'L1-4', name: 'title が存在し一意', defaultLevel: 'warn' },
  { id: 'L1-5', name: 'meta description が存在', defaultLevel: 'warn' },
  { id: 'L1-6', name: 'canonical が自ページを指す', defaultLevel: 'warn' },
  { id: 'L1-7', name: 'h1 がちょうど1つ', defaultLevel: 'warn' },
  { id: 'L1-8', name: 'html lang', defaultLevel: 'warn' },
  { id: 'L1-9', name: '本文が HTML に入っている', defaultLevel: 'warn' },
  { id: 'L1-10', name: 'og:title / og:description / og:image', defaultLevel: 'warn' },
  { id: 'L1-11', name: '公開日か更新日', defaultLevel: 'warn' },
  { id: 'L2-16', name: '画像の alt', defaultLevel: 'warn' },
  { id: 'L2-20', name: '見出しの階層', defaultLevel: 'warn' },
  { id: 'L2-21', name: 'title の長さ（15〜60）', defaultLevel: 'warn' },
  { id: 'L2-22', name: 'description の長さ（60〜160）', defaultLevel: 'warn' },
]

function decodePath(pathname: string): string {
  let decoded = pathname
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // 壊れたエスケープはそのまま比べる
  }
  return `/${routeKey(decoded)}`
}

export function lintOutDir(o: ResolvedOptions, outDir: string, pages?: Set<string>): Finding[] {
  if (o.lint.level === 'off') return []

  const levelOf = (id: string): LintLevel => o.lint.rules[id] ?? o.lint.level
  const findings: Finding[] = []
  const push = (id: string, page: string, message: string) => {
    const level = levelOf(id)
    if (level !== 'off') findings.push({ id, level, page, message })
  }

  // **サイトが生成したページだけを見る。** `public/` には埋め込み用の
  // HTML の断片が置かれていることがあり（notes の写真クレジットなど）、
  // それを1ページとして検査すると直しようのない指摘が出続ける。
  const files = walk(outDir, (p) => p.endsWith('.html'))
    .filter((f) => !pages || pages.has(routeKey(path.relative(outDir, f))))
    .sort()
  const titles = new Map<string, string[]>()

  for (const file of files) {
    const rel = path.relative(outDir, file)
    if (o.lint.exclude.some((x) => rel.startsWith(x.replace(/^\/+/, '')))) continue

    const page = `/${routeKey(rel)}`
    const p = parsePage(fs.readFileSync(file, 'utf8'))

    if (!p.title) push('L1-4', page, 'title がない')
    else titles.set(p.title, [...(titles.get(p.title) ?? []), page])

    if (!p.description) push('L1-5', page, 'meta description がない')
    else {
      const n = [...p.description].length
      if (n < 60 || n > 160) push('L2-22', page, `description が ${n} 文字（60〜160）`)
    }

    if (p.title) {
      const n = [...p.title].length
      if (n < 15 || n > 60) push('L2-21', page, `title が ${n} 文字（15〜60）`)
    }

    if (!p.canonical) push('L1-6', page, 'canonical がない')
    // **パーセントエンコードを戻してから比べる。** 日本語のタグページなどで
    // canonical は %E3%... 、ファイル名は生のUTF-8 になり、素で比べると全部
    // 「別のページを指している」と誤判定する。
    else if (decodePath(new URL(p.canonical, o.origin).pathname) !== `/${routeKey(rel)}`) {
      push('L1-6', page, `canonical が別のページを指している: ${p.canonical}`)
    }

    if (p.h1Count !== 1) push('L1-7', page, `h1 が ${p.h1Count} 個`)
    if (!p.lang) push('L1-8', page, 'html lang がない')
    // **これは SSR/CSR の判定であって、文章量の基準ではない。**
    // クライアント描画の空の器は100文字も無い。記事が1本しかない月別
    // アーカイブのような、短くて当たり前のページを落とさない値にしてある。
    if (p.textLength < 200) push('L1-9', page, `本文が ${p.textLength} 文字`)

    const missingOg = ['title', 'description', 'image'].filter((k) => !p.og[k])
    if (missingOg.length) push('L1-10', page, `${missingOg.map((k) => `og:${k}`).join('・')} がない`)

    if (!p.hasDate) push('L1-11', page, '公開日も更新日も出ていない')
    if (p.images && p.imagesWithoutAlt / p.images >= 0.05) push('L2-16', page, `alt がない画像 ${p.imagesWithoutAlt}/${p.images} 枚`)
    if (skipsHeadingLevel(p.headingLevels)) push('L2-20', page, '見出しのレベルが飛んでいる')
  }

  for (const [title, pages] of titles) {
    if (pages.length > 1) {
      for (const page of pages) push('L1-4', page, `title が ${pages.length} ページで重複: ${title}`)
    }
  }

  return findings
}

/** 結果を読める形にして出す。`error` が1件でもあれば true を返す（ビルドを落とす） */
export function reportFindings(o: ResolvedOptions, findings: Finding[]): boolean {
  if (findings.length === 0) return false

  const byRule = new Map<string, Finding[]>()
  for (const f of findings) byRule.set(f.id, [...(byRule.get(f.id) ?? []), f])

  const errors = findings.filter((f) => f.level === 'error')
  const head = errors.length ? '✗ machine-readability' : '⚠ machine-readability'
  console.log(`\n${head}  ${findings.length} 件（error ${errors.length} / warn ${findings.length - errors.length}）`)

  for (const rule of RULES) {
    const list = byRule.get(rule.id)
    if (!list?.length) continue
    console.log(`\n  ${rule.id} ${rule.name} — ${list.length} 件`)
    for (const f of list.slice(0, o.lint.maxReported)) console.log(`    ${f.page}  ${f.message}`)
    if (list.length > o.lint.maxReported) console.log(`    … ほか ${list.length - o.lint.maxReported} 件`)
  }
  console.log('')

  return errors.length > 0
}
