# How HookLab was built

HookLab started as an experiment: take a paid web app I use, Creator Hooks (a YouTube title and outlier research tool), study how it works with [REA (Reverse Engineer Anything)](https://github.com/morluto/rea), and rebuild my own version with AI coding agents. This is the short version of that process. HookLab contains no code, assets, or data from the original.

## 1. Point REA at the running app

REA connects to a Chrome-family browser over the DevTools Protocol. I signed in to the app in a dedicated browser profile and let REA attach to that tab, read-only.

- `list_browser_targets` found the open app tabs.
- `inspect_web_page` captured the page: DOM, accessibility tree, network metadata, storage keys, and the source of every script the page loaded.
- After clicking through every screen (so lazily loaded code arrived too), a second capture plus `export_web_scripts` wrote all of the app's JavaScript to disk with a verified manifest.

## 2. Read the bundles

- `analyze_web_bundle` identified the stack (Next.js App Router and React, deployed on Vercel), listed the API calls the client makes, and confirmed that no source maps were shipped.
- Searching the minified code showed how each screen works: filter defaults, the performance tiers (Flops < 0.3x up to Mega Bangers ≥ 50x), the 48 "click trigger" labels and the rule that colors them, title formats, and the chat's starter prompts.

## 3. Record one real AI chat

The heart of the product is the chat. REA's `capture_browser_scenario` drove one real exchange: click "Generate titles", describe a video, wait for the answer. It recorded the request and the streamed response. That showed the design:

- The answer streams as stages (preparing, routing, loading channel context, deep research, generating). Then titles arrive one at a time, then one "angle card" per angle, then a final payload.
- Every title is modelled on the structure of a specific high-performing video (a "skeleton"). It carries a click-trigger label and its inspiration sources. The recommended angle quotes real view counts and outlier multipliers.

## 4. Capture the look

Viewport and full-page screenshots, visible text, and a styled outline (classes and computed fonts and colours) of every screen became the visual spec. The original uses Satoshi for UI text, Roboto for video metadata, a navy primary colour, and green/blue/red chips.

## 5. Rebuild with agents

With the evidence in place, Claude Code built HookLab:

1. A foundation: data layer (`node:sqlite`), sidebar shell, video card, design tokens.
2. Four workers in parallel, each owning one area: Research (Outliers, Following, Bookmarks), Chat, My Channel and Studio, Projects and Settings.
3. A data CLI and REST API over the library, plus a live pipeline that finds new outliers by itself.

Some behaviours could be checked exactly. For example, the "your video vs. your recent average" multiplier on My Channel reproduces the original's numbers for every video compared.

## What HookLab does differently

- The chat runs on Claude (Opus 5.5), either through the Anthropic API or your signed-in Claude Code CLI, with its own prompts and pipeline.
- The outlier library is yours. Add channels and run the refresh pipeline: free YouTube RSS for polling, optional ScrapeCreators for discovery and metadata, Claude for tagging. New outliers then flow in on their own.
- Billing is a local ledger, so plans and credit packs work without a payment processor.
