import type { RobotsOptions } from './types.js'

/**
 * 生成AIのクローラ。
 *
 * **`User-agent: *` では効かないものがある。** とくに `Google-Extended` は
 * 検索のクロールとは別のグループとして扱われるので、明示しないと
 * 「許可しているつもり」で止まっていることに気づけない。
 * 逆に、どれかを止めたくなったときも書き換える場所が1つで済む。
 */
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
] as const

export function renderRobots(origin: string, o: RobotsOptions): string {
  const lines: string[] = ['User-agent: *', 'Allow: /', '']

  if (o.aiCrawlers !== false) {
    lines.push('# 生成AIのクローラを明示的に許可する。')
    lines.push('# User-agent: * では Google-Extended などに効かないため個別に書く。')
    for (const bot of AI_CRAWLERS) lines.push(`User-agent: ${bot}`, 'Allow: /', '')
  }

  if (o.extra) lines.push(o.extra.trim(), '')

  lines.push(`Sitemap: ${origin}/sitemap.xml`, '')
  return lines.join('\n')
}
