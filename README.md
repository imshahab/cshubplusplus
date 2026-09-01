# cshub++

A browser extension that enhances exam result pages on [test-cshub.ir](https://test-cshub.ir). Adds per-question **Copy** and **Ask AI** buttons so you can quickly extract questions (with LaTeX math) or get AI-generated explanations.

## Features

- **Copy Question** — Copies the full question text (prompt, options, correct answer, explanation) to clipboard with math rendered as LaTeX notation.
- **Ask AI** — Opens the question in ChatGPT, Claude, or DeepSeek with a pre-built Persian prompt asking for a detailed explanation.
- **LaTeX Math Extraction** — Intercepts MathJax-rendered math and converts it to clean `$...$` / `$$...$$` LaTeX notation, with a full MathML-to-LaTeX fallback.
- **SPA-Aware** — Uses MutationObserver, patched History API, and polling to work seamlessly with Next.js client-side navigation.
- **Auto-Expands Explanations** — Automatically opens collapsed explanation sections before copying or building the AI prompt.

## Installation

### Chrome / Edge / Brave

1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select this project directory
5. The extension appears in your extensions list

### Firefox

1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select `manifest.json` from this project directory

## Usage

1. Install the extension using the steps above
2. Navigate to any exam result page on test-cshub.ir (`/exam/{id}/result`) or a live exam page (`/exam/sequential/{id}`)
3. Two buttons appear on each question:
   - **کپی سوال** (Copy Question) — copies the question to your clipboard
   - **هوش مصنوعی** (Ask AI) — opens a dropdown to choose ChatGPT, Claude, or DeepSeek
4. Click the AI button and select a service. A new tab opens with the question pre-filled.

## Supported Pages

| URL Pattern | Description |
|---|---|
| `/exam/{id}/result` | Exam result / review pages |
| `/exam/sequential/{id}` | Live exam-taking pages |

## Project Structure

```
cshubplusplus/
├── manifest.json    # Browser extension manifest (Manifest V3)
├── content.js       # All extension logic (~479 lines)
└── icons/
    ├── icon16.png
    ├── icon32.png
    └── icon96.png
```

## Technical Details

- **Manifest V3** content script injected on all `test-cshub.ir` pages
- Single vanilla JavaScript file — no build step, no dependencies, no framework
- Math extraction uses MathJax's internal API (`MathJax.startup.document.math`) with a comprehensive MathML-to-LaTeX converter as fallback (40+ symbol mappings)
- Clipboard uses `navigator.clipboard.writeText()` with `document.execCommand('copy')` fallback
- AI prompts are built with a Persian-language prefix requesting a detailed, simple explanation
