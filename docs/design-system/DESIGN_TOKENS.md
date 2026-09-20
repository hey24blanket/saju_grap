# SajuGrap Design Tokens

Prototype UI visual foundation for `index.html`. This is not a redesign.

Admin RAG Manager (`admin/rag/index.html`) keeps its own local theme and is out of scope.

## Token hierarchy

```
Primitive  →  Semantic  →  Component  →  Screen
```

- **Primitive**: raw values. No UI meaning. `--gray-800`, `--space-2`, `--radius-lg`
- **Semantic**: role in the product UI. `--color-bg-app`, `--color-text-muted`
- **Component**: sparse aliases for real parts. `--glass-bg`, `--element-wood`, `--bottom-nav-height`
- **Screen**: pages compose components. Screens should not invent new hex values.

Future dark mode should override **semantic** tokens on `[data-theme="dark"]`. Do not scatter dark-specific hex into components.

Source of truth: `styles/tokens.css`

---

## Current style audit (pre-token)

Collected from the prototype `index.html` custom CSS + Tailwind utilities.

### Colors

Hardcoded hex in custom CSS / JS (normalized):

| Value | Count | Typical role |
| --- | --- | --- |
| `#a8a29e` | 9 | muted / faint text, chart tick |
| `#292524` | 7 | secondary text, water swatch, inverse buttons |
| `#78716c` | 6 | muted body text |
| `#b45309` | 4 | accent text / earth |
| `#1c1917` | 2 | primary text, inverse surfaces |
| `#44403c` | 2 | body text |
| `#ece7e1` | 1 | app canvas |
| `#8c827a` | 1 | chart x-tick (near gray-500) |
| Five-element solids | several | wood/fire/earth/metal/water dots |

~90 unique `rgba()` values, mostly glass whites and accent alphas.

Tailwind utilities still carry the stone / amber / rose / emerald palette in markup (`text-stone-800`, `bg-amber-500`, …). Those map to the same primitives.

**Same role, different values**

- Card / surface white: `rgba(255,255,255,.38 / .44 / .45 / .48 / .50 / .53 / .62 / .65 / .70)`
- Muted text: `#78716c` vs Tailwind `text-stone-500`
- Faint text: `#a8a29e` vs `text-stone-400`
- Inverse: `#1c1917` vs `#292524` vs `stone-950`

### Typography

- Family: SUIT Variable (prototype). Admin still uses Pretendard.
- Weights in custom CSS: 650, 700, 800, 900. Tailwind adds medium/semibold/bold/black.
- Sizes: 7 / 8 / 8.5 / 9 / 10 / 11 / 12 / 13 / 21 / 23px, plus `1.35rem` greeting and Tailwind `text-xs`–`text-3xl`.

### Radius

Custom CSS: 10, 12, 14, 15, 17, 18, 20, 22, 999px.

Tailwind: `rounded-full`, `rounded-xl`, `rounded-2xl`, plus 20 / 22 / 24 / 26 / 28 / 32 / 40px arbitrary values.

### Spacing

Custom CSS repeats 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 16px. Base unit is **4px with 2px half-steps**, plus odd 3/5/7/9/11 because the current UI uses them.

### Shadow

Repeated glass recipe: large warm drop + white inset + faint dark inset. Pills add colored drops. Tooltip uses a compact inverse shadow.

### Z-index

| Value | Surface |
| --- | --- |
| 0 | decorative blobs |
| 10 | onboarding / dashboard |
| 40 | bottom nav |
| 50 | chat + insight overlay |
| 80 | saju tooltip |
| 90 | DEV error toast button |
| 100 | developer error modal |

### Motion

- fade-in 200ms `cubic-bezier(0.16, 1, 0.3, 1)`
- tooltip 120ms ease
- tube height 800ms spring
- Tailwind `transition` / `active:scale-[0.98]`

### Breakpoints

| Width | Where |
| --- | --- |
| 640px | prototype custom CSS (`@media (max-width: 640px)`) and Tailwind `sm` |
| 768px | Tailwind `md` (page padding, a few type sizes) |
| 850px | admin RAG only |

CSS variables cannot drive `@media`. Keep these as documented constants.

### Inline styles

- Tube fill heights (`height: 50%`) — runtime score, not tokenized
- Five-element dots (migrated to swatch classes)
- Day-master compact card 46×46 (migrated to `--size-saju-char-compact`)

---

## Color

### Primitive

`--white`, `--gray-50` … `--gray-950`, `--warm-100` (`#ece7e1`), amber / red / green / purple scales, plus the glass alpha steps actually used by the current UI.

### Semantic

| Token | Current value | Meaning |
| --- | --- | --- |
| `--color-bg-app` | `--warm-100` | Page canvas |
| `--color-bg-surface` | `--white` | Solid modal / chat sheet |
| `--color-bg-surface-muted` | `--white-a-45` | Inner cards |
| `--color-bg-elevated` | `--white-a-65` | Liquid glass |
| `--color-text-primary` | `--gray-900` | Titles |
| `--color-text-secondary` | `--gray-800` | Strong body / card titles |
| `--color-text-muted` | `--gray-500` | Supporting copy |
| `--color-text-faint` | `--gray-400` | Kickers / captions |
| `--color-border-subtle` | `--white-a-75` | Glass edge |
| `--color-accent-primary` | `--amber-500` | Primary actions |
| `--color-accent-secondary` | `--amber-700` | Accent text |
| `--color-success` | `--green-700` | Success |
| `--color-warning` | `--amber-700` | Warning |
| `--color-danger` | `--red-700` | Danger |

**Use in CSS**

```css
body { background: var(--color-bg-app); }
.dash-greeting h2 { color: var(--color-text-primary); }
```

Next dashboard redesign should start by changing these semantic tokens.

---

## Five Elements

These are information colors, not accent decoration. Do not reuse `--color-accent-*` for 목/화/토/금/수.

| Element | Text | Fill token | Dot |
| --- | --- | --- | --- |
| Wood 목 | `--element-wood` (`#047857`) | `--element-wood-fill` | `--element-wood-dot` (`#6ee7b7`) |
| Fire 화 | `--element-fire` (`#b91c1c`) | `--element-fire-fill` | `--element-fire-dot` (`#fca5a5`) |
| Earth 토 | `--element-earth` (`#b45309`) | `--element-earth-fill` | `--element-earth-dot` (`#fbbf24`) |
| Metal 금 | `--element-metal` (`#57534e`) | `--element-metal-fill` | `--element-metal-dot` + border |
| Water 수 | `--element-water` (`#fff`) | `--element-water-fill` | `--element-water-dot` (`#292524`) |

Classes:

- Card / chip: `.el-wood` … `.el-water`
- Swatch: `.el-swatch-wood` … `.el-swatch-water`

JS maps engine element **names** (`wood`) to those classes. Engine enums are unchanged.

---

## Typography

| Semantic | Size | Weight | Use |
| --- | --- | --- | --- |
| `--text-display` | 1.875rem | black | Onboarding title (Tailwind `text-3xl`) |
| `--text-heading-xl` | 1.35rem | black | Dashboard greeting |
| `--text-heading-md` | 13px | black | Accordion title |
| `--text-body-md-size` | 12px | 650 | Greeting subtitle, graph note |
| `--text-caption-size` | 9–10px | 800–900 | Kickers, nav labels |
| `--text-saju-char` | 23px | black | Natal glyphs |

Family: `--font-family-ui` → SUIT Variable.

---

## Spacing

4px base. Half-steps match Tailwind (`--space-1-5` = 6px). Odd steps `--space-0-75` (3px) through `--space-2-75` (11px) exist because the current layout uses them.

| Token | Value |
| --- | --- |
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-6` | 24px |
| `--space-32` | 128px (dashboard bottom padding / nav clearance) |

Do not snap 11px cards to 12px in this foundation. That would shift layout.

---

## Radius

| Token | Value | Use |
| --- | --- | --- |
| `--radius-xs` | 10px | tiny controls |
| `--radius-sm` | 12px | chips |
| `--radius-md` | 14px | tooltip |
| `--radius-lg` | 16px | Tailwind `rounded-2xl` |
| `--radius-xl` | 20px | graph note, chat user bubble |
| `--radius-2xl` | 22px | accordion / engine shell / AI bubble |
| `--radius-24` | 24px | chart container, primary CTA |
| `--radius-3xl` | 28px | dashboard cards, modals |
| `--radius-4xl` | 32px | chat sheet |
| `--radius-sheet` | 40px | onboarding card |
| `--radius-pill` | 999px | pills |
| `--radius-15` / `17` / `18` / `26` | as named | existing component sizes, not snapped |

Component aliases: `--radius-card`, `--radius-control`, `--bottom-nav-radius`.

---

## Shadow

| Token | Meaning |
| --- | --- |
| `--shadow-xs` | natal glyph |
| `--shadow-sm` | manse pillar |
| `--shadow-md` | inner card drop |
| `--shadow-lg` | glass page card |
| `--shadow-floating` | tooltip |

Glass and pills use component recipes (`--glass-shadow`, `--pill-*-bg`) so inset highlights stay exact.

---

## Motion

| Token | Value | Use |
| --- | --- | --- |
| `--duration-fast` | 120ms | tooltip |
| `--duration-normal` | 200ms | fade-in |
| `--duration-slow` | 800ms | tube fill |
| `--ease-standard` | ease | tooltip |
| `--ease-emphasized` | cubic-bezier(0.16, 1, 0.3, 1) | fade-in |
| `--ease-spring` | cubic-bezier(0.34, 1.56, 0.64, 1) | tube |

---

## Z-index

| Token | Value | Surface |
| --- | --- | --- |
| `--z-base` | 0 | blobs |
| `--z-content` | 10 | page |
| `--z-bottom-nav` | 40 | bottom nav |
| `--z-overlay` | 50 | chat / insight |
| `--z-tooltip` | 80 | saju tooltip |
| `--z-toast` | 90 | DEV error button |
| `--z-modal` | 100 | developer error |

Utility classes: `.z-base`, `.z-content`, `.z-bottom-nav`, `.z-overlay`, `.z-tooltip`, `.z-toast`, `.z-modal`.

---

## Layout

| Token | Value | Meaning |
| --- | --- | --- |
| `--page-max-width` | 42rem | dashboard column |
| `--page-padding-y` | 24px | dash page bottom |
| `--bottom-nav-height` | 128px | body clearance when dashboard is open |
| `--bottom-nav-offset` | 10px | distance from viewport bottom |
| `--bottom-nav-inset` | 16px | horizontal inset |
| `--size-chart-height` | 14.5rem | wave chart |
| `--size-saju-char` | 48px | natal glyph |
| `--size-saju-char-compact` | 46px | day-master glyph |
| `--control-height-lg` | 44px | chat input min-height |
| `--size-chat-height` | 80vh | chat sheet |

---

## Remaining hardcoded values

Left on purpose:

- **Tailwind utility colors** (`text-stone-800`, `bg-amber-500`, `border-stone-100`, …). Replacing every utility would be a redesign-sized markup pass. They already match the primitive stone/amber scales. Next redesign can point Tailwind theme keys at semantic tokens.
- **Chart geometry**: line width 3.8 / 1.2, point radius 4, tension 0.45, y-domain ±100. Chart.js behavior, not theme.
- **Tube `height: 50%`**: runtime score fill.
- **Role strip `minmax(58px, 1fr)`**: one-off overflow layout at 640px.
- **Decorative blob size / blur**: `w-80`, `blur-[70px]`.
- **Admin RAG theme**: separate Pretendard surface. Do not mix into prototype tokens.
- **Font Awesome** icon font.

---

## How to restyle later

Change these first:

```css
--color-bg-app
--color-bg-surface
--color-text-primary
--color-text-secondary
--color-border-subtle
--color-accent-primary
--radius-card
--radius-control
--shadow-card
--shadow-floating
--space-page-x
--space-section
--space-card
```

Five-element tokens stay on their own track so a brand restyle cannot accidentally recode 목/화/토/금/수.
