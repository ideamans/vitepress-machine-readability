import { defineConfig } from 'vitepress'

import { withMachineReadability } from '../../../dist/index.js'

export default defineConfig(
  withMachineReadability(
    {
      title: 'Fixture Site',
      description: 'テスト用の小さなサイト',
      mpa: true,
      // サイト側が自前で持っているフックを潰さないことの確認
      transformHead: () => [['meta', { name: 'x-site-own', content: '1' }]],
      buildEnd: () => {
        console.log('[fixture] サイト側の buildEnd が呼ばれた')
      },
    },
    {
      hostname: 'https://fixture.example.com/',
      siteName: 'Fixture Site',
      organization: { name: 'Example Inc.', url: 'https://example.com/', logo: '/logo.svg' },
      defaultImage: '/ogp.png',
      map: { description: ['excerpt', 'description'] },
      feed: { pattern: 'posts/**/*.md', title: 'Fixture Feed', alias: ['/atom.xml'] },
      markdownSource: true,
      lint: 'warn',
    }
  )
)
