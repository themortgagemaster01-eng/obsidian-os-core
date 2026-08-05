# 09 — UI Design System

## Dark-mode-only, by intent

There is no light theme and none is planned. `tailwind.config.ts` sets `darkMode: ["class"]`; `app/layout.tsx` hardcodes `<html lang="en" className={`dark ${inter.variable}`}>` — dark mode is not conditional on system preference, it is the only mode. `app/globals.css` additionally forces `color-scheme: dark` on `html`. Any future feature work that assumes a light-mode variant exists (e.g. a theme toggle) is out of scope unless explicitly re-decided — it would be a real design regression, not a neutral addition.

## Color tokens (`tailwind.config.ts`)

| Token | Value | Usage |
|---|---|---|
| `background` | `#0A0A0B` | Page background |
| `panel` | `#121214` | Card/panel surfaces |
| `panel-hover` | `#17171A` | Hover state on interactive panels/rows |
| `border.DEFAULT` | `rgba(255,255,255,0.08)` | Hairline borders throughout |
| `border.subtle` | `rgba(255,255,255,0.05)` | Even quieter dividers |
| `navy.DEFAULT` | `#0B1220` | Reserved navy tone |
| `navy.accent` | `#1E3A5F` | Accent usage — e.g. the `navy` badge variant for in-progress mission states |
| `foreground` | `#FAFAFA` | Primary text |
| `muted.DEFAULT` / `muted.foreground` | `#1A1A1D` / `rgba(250,250,250,0.6)` | Secondary surfaces / secondary text |
| `primary` | `#FAFAFA` on `#0A0A0B` | Primary buttons (inverted — light fill, dark text) |
| `destructive` | `#7F1D1D` | Destructive actions |

No loud gradients, no cartoon graphics, no bright saturated accent colors beyond the muted navy and the semantic badge colors (emerald/amber/red at 15% opacity fills — see `components/ui/badge.tsx`'s `success`/`warning`/`destructive` variants). The reference points named in the product vision — Tesla, Apple, Linear, Vercel, Notion — are about restraint and confidence, not minimalism for its own sake: panels still have real depth (`shadow-panel: 0 8px 30px rgba(0,0,0,0.35)`) and texture (`.glass-panel`'s `backdrop-blur-md`), just no visual noise.

## The `.glass-panel` utility

Defined in `app/globals.css`:

```css
.glass-panel {
  @apply bg-panel/80 backdrop-blur-md border border-border rounded-lg shadow-panel;
}
```

Translucent panel background at 80% opacity, blurred backdrop, hairline border, soft shadow, `0.75rem` radius. This is the one signature visual motif in the design system — used today on the login card (`app/login/page.tsx`) and intended as the default treatment for any future elevated surface (modals beyond the shadcn `Dialog` default, the future Approval Queue's mission cards, etc.).

## Typography

Inter, loaded via `next/font/google` with the `--font-inter` CSS variable (`app/layout.tsx`), applied through Tailwind's `fontFamily.sans` extension. No serif or display font pairing — one typeface, weight and size do the differentiation work (e.g. `text-lg font-semibold tracking-tight` for the Mission Control header, `text-2xl font-semibold` for stat card values, `text-xs uppercase tracking-wide text-muted-foreground` for the login screen's "or" divider label).

## Spacing and radius

Conservative and generous: container padding is `2rem` with a `1400px` max at the `2xl` breakpoint (`tailwind.config.ts`'s `container` extension). Border radii are small and consistent — `lg: 0.75rem`, `md: 0.5rem`, `sm: 0.375rem` — never sharp corners, never pill-everything.

## Animation constraints — 200–300ms, no bounce, enforced in practice

The Tailwind config sets a default `transitionDuration` of `250ms` and `transitionTimingFunction` of `ease`. Every interactive transition actually written in the codebase stays within this band explicitly: `stat-card.tsx`'s hover (`transition-colors duration-200 ease-in-out`), `mission-list.tsx`'s row hover (`transition-colors duration-200 ease-in-out`), `badge.tsx`'s variant transitions (`transition-colors duration-200 ease-in-out`). No spring/bounce easing curve is used or configured anywhere — `tailwindcss-animate` (used for the shadcn `Dialog`'s open/close) is configured with its defaults, which are linear/ease-based, not bouncy. Any future component should match this: pick a duration between 200–300ms and an `ease`/`ease-in-out` curve, never a spring.

## Component inventory

Hand-rolled shadcn/ui primitives built on Radix UI, living in `components/ui/`:

- `avatar.tsx` (`@radix-ui/react-avatar`)
- `badge.tsx` — variants `default`, `outline`, `navy`, `success`, `warning`, `destructive`, via `class-variance-authority`
- `button.tsx`
- `card.tsx` (`Card`, `CardHeader`, `CardTitle`, `CardContent`)
- `dialog.tsx` (`@radix-ui/react-dialog`) — `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`
- `input.tsx`
- `label.tsx` (`@radix-ui/react-label`)
- `separator.tsx` (`@radix-ui/react-separator`)
- `skeleton.tsx`

Composed into product-specific components in `components/mission-control/`: `stat-card.tsx`, `mission-list.tsx`, `state-badge.tsx`, `new-mission-dialog.tsx`, `sign-out-button.tsx`.

## Accessibility posture

Inherited, not audited. Radix primitives provide real baseline accessibility — keyboard navigation and focus trapping in `Dialog`, correct `label`/`input` association via `Label`, ARIA roles from Radix's underlying implementations. But **no dedicated accessibility review has been performed on this codebase** — no color-contrast audit against WCAG thresholds (the `muted-foreground` text at `rgba(250,250,250,0.6)` on a near-black background should be checked, not assumed compliant), no screen-reader walkthrough, no keyboard-only navigation test end to end. Treat this as a real, unaddressed gap, not a checked box — flagged again in `docs/10-Development-Standards.md`.
