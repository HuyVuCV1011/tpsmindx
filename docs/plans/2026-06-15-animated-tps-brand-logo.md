# Animated TPS Brand Logo Implementation Plan

**Goal:** Use the supplied TPS artwork as the application brand and animate only the X mark on desktop.

**Architecture:** Convert the supplied raster artwork into transparent X and TPS wordmark layers. Render both layers through a shared React component, with a CSS-only desktop animation and a reduced-motion/mobile static fallback. Use a padded X-only version for PWA and Apple icons.

**Tech Stack:** Next.js 16, React 19, CSS Modules, PNG assets, Node test runner.

## Tasks

1. Add a source-level regression test for the layered logo, desktop-only motion, reduced-motion fallback, login integration, and PWA icon references.
2. Remove the near-white background from the supplied image and export transparent X and TPS wordmark layers.
3. Generate 192px, 512px, and maskable application icons from the X layer.
4. Build `TpsBrandLogo` with an animated X and stationary TPS wordmark.
5. Replace the desktop and mobile login logos with the new component.
6. Update application metadata and manifest icons.
7. Run the focused test, ESLint, TypeScript, build checks, and rendered login verification where browser policy permits.
