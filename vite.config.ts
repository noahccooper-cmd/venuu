import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Social brand assets (logos, product images) are for a private,
  // flag-gated demo only. The alias points at the real folder only when
  // VITE_SOCIAL_THEME=suncruiser; otherwise at an empty path, so a flag-off
  // (App Store) build never contains a single brand file.
  const env = loadEnv(mode, process.cwd(), '')
  const brandTheme = env.VITE_SOCIAL_THEME === 'suncruiser'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@social-brand-assets': path.resolve(
          __dirname,
          brandTheme ? 'src/assets/social' : 'src/assets/social-disabled',
        ),
      },
    },
  }
})
