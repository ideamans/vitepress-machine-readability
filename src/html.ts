/**
 * 生成された HTML を読む。
 *
 * **設定ではなく出力を見る**のが要点。設定を入れたつもりでも、MPA では
 * テーマのクライアント側の実装が動かず出ていないことがある。
 * パーサは使わず正規表現で足りる範囲だけを見る。
 */
export interface ParsedPage {
  title?: string
  description?: string
  canonical?: string
  lang?: string
  og: Record<string, string>
  h1Count: number
  headingLevels: number[]
  images: number
  imagesWithoutAlt: number
  hasDate: boolean
  textLength: number
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function parsePage(html: string): ParsedPage {
  const one = (re: RegExp): string | undefined => {
    const m = html.match(re)
    return m?.[1] ? decode(clean(m[1])) : undefined
  }

  const og: Record<string, string> = {}
  for (const m of html.matchAll(/<meta[^>]+property=["']og:([a-z:_]+)["'][^>]+content=["']([^"']*)["']/gi)) {
    if (m[1] && m[2]) og[m[1]] = clean(m[2])
  }

  const headings = [...html.matchAll(/<h([1-6])[\s>]/gi)].map((m) => Number(m[1]))
  // **`alt=""` は「装飾画像なので読み飛ばして」という正しい指定。**
  // 未設定と同じに数えると、テーマが出すロゴやアイコンで永久に警告が出続ける。
  // 問題なのは alt が **無い** 画像だけ。
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0])

  const text = clean(
    html
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )

  return {
    title: one(/<title[^>]*>([\s\S]*?)<\/title>/i),
    description: one(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i),
    canonical: one(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i),
    lang: one(/<html[^>]+lang=["']([^"']*)["']/i),
    og,
    h1Count: headings.filter((l) => l === 1).length,
    headingLevels: headings,
    images: imgs.length,
    imagesWithoutAlt: imgs.filter((t) => !/\salt\s*=/i.test(t)).length,
    hasDate:
      /<time[^>]+datetime=["'][^"']+["']/i.test(html) ||
      /property=["']article:(published|modified)_time["']/i.test(html) ||
      /"date(Published|Modified)"\s*:/.test(html),
    textLength: text.length,
  }
}

export function skipsHeadingLevel(levels: number[]): boolean {
  let prev = 0
  for (const l of levels) {
    if (prev && l > prev + 1) return true
    prev = l
  }
  return false
}
