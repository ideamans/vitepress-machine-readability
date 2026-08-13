import fs from 'node:fs'

/**
 * 本文の冒頭から説明文を起こす。
 *
 * **これは「生成」ではなく「抜き出し」。** 著者が書いた最初の段落をそのまま使う。
 * 要約をこちらで作文すると、本文と食い違ったものが検索結果に出てしまう。
 *
 * 効くのは「ページ固有の説明文がそもそも無い」サイト。そういうサイトでは
 * VitePress がサイト共通の説明文を全ページに出すので、**何百ページが
 * まったく同じ説明文**になる。短い説明文を直す用途ではない。
 */
export function excerptOf(filePath: string, maxChars: number): string | undefined {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }

  const body = raw
    .replace(/^---\n[\s\S]*?\n---\n/, '') // frontmatter
    .replace(/^```[\s\S]*?^```/gm, '') // コードブロック
    .replace(/^:::[\s\S]*?^:::/gm, '') // VitePress のコンテナ
    .replace(/<[^>]+>/g, '') // 生のHTML・Vueコンポーネント

  for (const block of body.split(/\n{2,}/)) {
    const line = block.trim()
    if (!line) continue
    if (line.startsWith('#')) continue // 見出し
    if (line.startsWith('|') || line.startsWith('>')) continue // 表・引用
    if (/^[-*+]\s|^\d+\.\s/.test(line)) continue // 箇条書き
    if (/^!\[/.test(line)) continue // 画像だけの段落

    const text = line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 画像
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // リンクは文字だけ残す
      .replace(/[*_`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    if ([...text].length < 20) continue
    return trimTo(text, maxChars)
  }
  return undefined
}

/** 句点で切れるならそこで切る。無理なら文字数で切って「…」を付ける */
function trimTo(text: string, maxChars: number): string {
  const chars = [...text]
  if (chars.length <= maxChars) return text

  const head = chars.slice(0, maxChars).join('')
  const lastStop = Math.max(head.lastIndexOf('。'), head.lastIndexOf('. '))
  if (lastStop > maxChars * 0.5) return head.slice(0, lastStop + 1)
  return `${head}…`
}
