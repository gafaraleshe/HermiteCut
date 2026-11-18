# Website redesign brief: hermitelabs.com + /cut

**For:** the coding agent working on the website repo (`gafaraleshe/HermiteLabs`).
**Owner:** Gafar, Gaffy Studios. This is a real business, not a portfolio
piece, so build it to sell.

## 1. Goal

Rebuild **hermitelabs.com/cut** as a **production product page that sells
HermiteCut**, and bring **hermitelabs.com** (the home page) into the same
design.

- It should feel like a premium tool store, at the level of the best
  single-product plugin pages.
- It must stay **unmistakably Hermite Labs**:
  - monochrome base;
  - one accent per product, with HermiteCut's accent `#b9acff`;
  - the existing Clay design system, type scale and tone ("The parent is
    silent. The products speak in colour.").

Start with **HermiteCut only**. The owner will add more products ("drops")
later, so:
- **Do not** add placeholder or "coming soon" drop cards now.
- **Do** build the product data and routes so another product page can be added
  from one data file.

## 2. Design references (pattern only, never content)

The owner likes these two pages. Copy their **layout ideas and level of
polish**, never their text, images, videos, product names or code. The owner
prefers the first.

1. **https://thecreativeherd.com/tools/time-drift/** (main reference):
   - dark, spacious, single column;
   - small uppercase category label → big product title → one-line promise →
     price → one primary **Buy** button, with a quiet "secure checkout ·
     instant download" note;
   - a row of compact stat badges;
   - a sticky in-page section menu;
   - an overview with a **before / after drag-to-compare slider**;
   - one showcase section per effect, with **style pills** that switch the
     preview;
   - a short FAQ accordion, a closing CTA and a small footer.
2. **https://oscarmerinostore.com/products/viral-transitions-pack:**
   - simple trust badges (instant download, secure payment, drag and drop);
   - a short emoji-free feature list;
   - one "see them in action" demo video;
   - payment and policy links in the footer.

**Keep it simple and clean:** cards, clear CTAs, lots of space. No pop-ups and
no countdown timers.

## 3. /cut page structure

1. **Nav:** Hermite Labs wordmark, then HermiteCut, Docs, Changelog and Support.
   Add a cart / **Buy** button on the right.
2. **Hero:**
   - label `DAVINCI RESOLVE · TOOLKIT`;
   - H1 **HermiteCut**;
   - one-line promise (motion, transitions, effects, titles, sound and captions
     in one panel);
   - price and **Buy HermiteCut**, with a secondary **Watch the demo**;
   - a note: "Secure checkout · Instant download · Windows & macOS".
3. **Stat badges:** for example "60+ effects & transitions", "80+ sound
   effects", "Works inside Resolve", "Windows & Mac". Use real numbers only:
   read them from the product data, never hard-code them.
4. **Sticky section menu:** Overview · Effects · Transitions · Grid Reveal ·
   Titles · Sound · Tools · FAQ.
5. **Overview:** a before / after slider using **our own** renders from the
   test clips or the owner's footage.
6. **Showcase sections**, one per family:
   - **Effects** (style pills: Flash / Shake / Blur / Glitch / Film);
   - **Time FX** (Slow Shutter with 180° / 360° / 720° / 1440° pills, Echo,
     Prism, Stutter, Time Shift);
   - **Transitions**;
   - **Grid Reveal**, the hero feature (see `docs/reference/grid-reveal.md`);
   - **Titles & captions**;
   - **Sound library**, with click-to-play waveform cards.

   Each section gets a short title, one sentence and a looping muted preview.
   Previews are short H.264 / WebM loops under 1.5 MB with poster images,
   lazy-loaded.
7. **Tools grid:** cards for Ease, Align, Actions, Motion, Bounce, Beats,
   Captions and Shorts. Each card has an icon, a name and one line.
8. **How it works:** three steps (Install → open in Resolve → click), with a
   small panel screenshot.
9. **Compatibility card:** DaVinci Resolve Studio 19+ (and what works in the
   free version), Windows 10/11, macOS 12+ on Apple Silicon and Intel.
10. **Pricing card:** one clear price, a list of what's included, the update
    policy, and the Buy button again.
11. **FAQ:** 5–7 questions:
    - Does it work in free Resolve?
    - Mac and Windows?
    - How do I install?
    - Updates?
    - Refunds?
    - Licence and how many machines?
    - Support?
12. **Closing CTA:** one line and Buy.
13. **Footer:**
    - products, docs, changelog, support, terms, privacy, refunds, licence;
    - social icons;
    - "© 2026 Hermite Labs".

## 4. Credit (minimal)

- Footer only, once, small: **"Made by Gafar · Gaffy Studios"**, linking to
  the owner's site.
- On the home page, keep the existing quiet eyebrow, "Hermite Labs — by Gaffy
  Studios".
- Nothing louder than that. It's a business page, not a personal portfolio.

## 5. Home page (hermitelabs.com)

Same design system:
- hero;
- the HermiteCut product card as the featured product, linking to /cut;
- the existing products that are actually live (HermiteFlow).

**Remove "planned" placeholders** for now (see §1). Keep "How we build" and
the footer, restyled to match.

## 6. Commerce: production-ready

- **Payments:** use a **merchant of record** (Lemon Squeezy or Paddle). It
  handles UK and EU VAT and sales tax, invoices and refunds, so the owner
  doesn't have to file VAT in every country. Use a hosted checkout overlay;
  don't build card forms.
- **Delivery:**
  - The checkout webhook goes to a small serverless function.
  - The function issues a **licence key** and a signed, expiring download
    link.
  - Installers are stored in **Cloudflare R2**, which has no bandwidth fees.
  - Customers re-download from a simple "My downloads" page reached by email
    link. No passwords.
- **Licence:** the key is checked once in the app's Setup screen and stored
  locally. Allow 2 machines per licence, and let the customer reset the
  activation themselves.
- **Legal pages:** Terms of sale, EULA, Privacy, Refunds (14 days is
  standard), Cookies. Include the company details for Gaffy Studios Ltd.
- **Email:** order confirmation and download links, through the merchant of
  record or a transactional email service.

## 7. Quality bar

- **Lighthouse 95+** on mobile for Performance, Accessibility, Best Practices
  and SEO.
- No layout shift. Video previews are paused off-screen and respect
  `prefers-reduced-motion`.
- Responsive from 360 px up. Keyboard accessible. AA contrast on the accent.
- SEO:
  - titles, descriptions and Open Graph / Twitter images per page;
  - `Product` and `FAQPage` structured data;
  - sitemap and robots.txt.
- Privacy-friendly analytics, such as Cloudflare Web Analytics. No cookie
  banner needed unless marketing pixels are added.
- Error pages, a 404, and a `/changelog` fed from HermiteCut's `CHANGELOG.md`.

## 8. Hosting

Move to **Cloudflare**:
- Pages for the site;
- Workers for the checkout webhook and licence/download functions;
- R2 for installers and preview videos.

Bandwidth is free, which matters for video-heavy pages and installer downloads.
Vercel's Pro plan meters bandwidth beyond 1 TB.

## 9. Open decisions for the owner

- **Price** (and launch discount, if any).
- **Lemon Squeezy or Paddle.**
- **Code licence vs selling.** The HermiteCut repo is public under MIT, so
  anyone may legally build and give it away. To sell, either:
  - make the repo private and relicense **future** versions (the owner holds
    the copyright; code already published stays MIT); or
  - keep the core open and sell the templates, sound packs, signed installers,
    updates and support.
- **Code signing:** an Apple Developer ID ($99/yr, with notarisation) and a
  Windows code-signing certificate, so buyers don't see security warnings.
  Strongly recommended before taking money.
