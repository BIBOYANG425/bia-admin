# BIA@USC Landing Page Design

## Direction: Warm Minimal

Inspired by piscinasdecemento.com (warm monochrome, scroll reveals, luxury calm), antidote.email (oversized type, one job per section), and Mile Inn (editorial typography, bold and confrontational).

## Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--cream` | `#F2EBD9` | Primary background |
| `--cream-light` | `#FAF6EC` | Alternate sections |
| `--ink` | `#1A1410` | Primary text |
| `--ink-muted` | `#8C7E6A` | Secondary text |
| `--crimson` | `#990000` | Single accent (CTAs, links, hovers) |
| `--white` | `#FFFFFF` | Cards, overlays |

## Typography

- Chinese headlines: Noto Serif SC (Google Fonts)
- English headlines: Noto Serif SC or Playfair Display
- Body/UI: system sans-serif stack
- H1: clamp(60px, 10vw, 120px), weight 700
- Body: 18px, weight 400

## Sections (scroll order)

### 1. Hero (full viewport)
- Cream background, fills 100svh
- "BIA" in massive serif (120px+), left-aligned
- "Bridging Internationals Association" below in lighter weight
- "USC . Est. 2024" below
- Subtle scroll indicator with pulse animation
- No images, no CTA button. The name owns the space.

### 2. Mission (one sentence)
- Cream-light background
- One centered sentence: "An international student community at USC dedicated to helping members build connections, achieve growth, and find career direction."
- Fades in on scroll

### 3. Three Pillars (editorial rows)
- Full-width rows, not cards, not columns
- Each row: number (01/02/03) in muted, pillar name in serif, description on right
- Separated by thin 1px horizontal rules
- No icons, no circles

### 4. Services (tool gateway)
- Heading: "New Student Services" / "新生服务"
- Grid of minimal cards linking to tools:
  - 找室友 (Roommates) -> /roommates
  - 转租 (Sublease)
  - 找搭子 (Companions)
  - 选课 (Courses)
  - 课评 (Reviews)
  - USC 新生群 (WeChat)
- Cream cards, thin border, serif name, arrow icon
- Hover: crimson border, subtle lift

### 5. Events (social proof)
- 2-3 event highlights, horizontal layout
- Event name, date, attendance
- Placeholder for photos
- List-style, not gallery

### 6. Connect (dark footer)
- Ink background, cream text
- "Join BIA" in large serif
- Instagram, Xiaohongshu, WeChat links
- Copyright line

## Motion
- Scroll-driven fade-ins (CSS + Intersection Observer)
- Hover transitions: 200ms ease-out
- Scroll indicator pulse
- prefers-reduced-motion respected

## Responsive
- Typography scales via clamp()
- Pillars stack vertically on mobile
- Services: 2-col grid on mobile
- No hamburger menu (minimal nav: logo + one CTA)

## Architecture
- `/` = new landing page (Server Component)
- `/roommates` = current roommate tool (moved from /)
- Scroll animations via tiny client wrapper
- Google Fonts: Noto Serif SC
