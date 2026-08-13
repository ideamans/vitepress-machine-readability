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

  const prose: string[] = []
  for (const block of body.split(/\n{2,}/)) {
    for (const line of block.split('\n')) {
      const t = line.trim()
      if (!t) continue
      if (/^[#|>!]/.test(t)) continue // 見出し・表・引用・画像
      if (/^[-*+]\s|^\d+\.\s/.test(t)) continue // 箇条書き

      const text = t
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // リンクは文字だけ残す
        .replace(/https?:\/\/\S+/g, '') // 裸のURLは入れない
        .replace(/[*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()

      if (text.length >= 6) prose.push(text)
    }
    if (prose.join('').length > 400) break
  }
  if (!prose.length) return undefined

  // **文の切れ目で終わらせる。** 途中で切って「…」を付けると、
  // 元の（機械で切られた）抜粋と同じものができてしまう。
  const sentences = prose.join(' ').split(/(?<=[。！？])/).filter((x) => x.trim())
  let out = ''
  for (const raw of sentences) {
    const sent = raw.trim()
    // 見出しが1文として紛れ込むことがある（句点が無く短い）
    if (!out && sent.length < 25 && !/[。！？]$/.test(sent)) continue
    if (out && out.length + sent.length > maxChars) break
    out += sent
    if (out.length >= 60) break
  }

  out = out.trim()
  if (out.length < 20) return undefined
  return out.length > maxChars ? trimTo(out, maxChars) : out
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
