import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('login uses the layered TPS brand logo', () => {
  const loginSource = readFileSync(new URL('app/login/page.tsx', root), 'utf8')
  const logoSource = readFileSync(
    new URL('components/brand/TpsBrandLogo.tsx', root),
    'utf8',
  )
  const logoStyles = readFileSync(
    new URL('components/brand/TpsBrandLogo.module.css', root),
    'utf8',
  )

  assert.match(loginSource, /<TpsBrandLogo/)
  assert.match(logoSource, /\/brand\/tps-logo-x\.png/)
  assert.match(logoSource, /\/brand\/tps-logo-wordmark\.png/)
  assert.match(logoStyles, /@media \(min-width: 768px\)/)
  assert.match(logoStyles, /prefers-reduced-motion: no-preference/)
})

test('PWA icons use the supplied TPS mark', () => {
  const manifestSource = readFileSync(new URL('app/manifest.ts', root), 'utf8')

  assert.equal(existsSync(new URL('public/icon-192.png', root)), true)
  assert.equal(existsSync(new URL('public/icon-512.png', root)), true)
  assert.equal(existsSync(new URL('public/icon-maskable-512.png', root)), true)
  assert.match(manifestSource, /\/icon-maskable-512\.png/)
  assert.match(manifestSource, /purpose: 'maskable'/)
})
