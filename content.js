// CSHub Exam Result Helper — content script (browser extension build)
// Adds Copy and Ask-AI buttons to each question on test-cshub.ir exam
// result pages, comprehensive/sequential exam pages, and the
// /me/questions selected-questions list. Math is converted to LaTeX;
// images become a URL note.

(function () {
  'use strict';

  // ---------- LaTeX extraction from mjx-container ----------

  const SYMBOL_MAP = {
    '∗': '*', '∩': '\\cap', '∪': '\\cup', '∅': '\\emptyset',
    'ε': '\\epsilon', 'ϵ': '\\epsilon',
    '≤': '\\le', '≥': '\\ge', '≠': '\\neq',
    '∈': '\\in', '∉': '\\notin', '⊆': '\\subseteq', '⊂': '\\subset',
    '∞': '\\infty', '→': '\\to', '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow',
    '×': '\\times', '÷': '\\div',
    '∑': '\\sum', '∏': '\\prod', '∫': '\\int',
    '∀': '\\forall', '∃': '\\exists', '¬': '\\neg', '∧': '\\wedge', '∨': '\\vee',
    '⋅': '\\cdot', '⁡': '', '⁢': '', '–': '-', '−': '-',
    'λ': '\\lambda', 'Σ': '\\Sigma', '∣': '\\mid',
  };
  function symOf(t) {
    t = t.trim();
    return SYMBOL_MAP.hasOwnProperty(t) ? SYMBOL_MAP[t] : t;
  }
  function wrap(s) { return s.length > 1 ? `{${s}}` : s; }

  function mathmlToLatex(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    const tag = node.tagName ? node.tagName.toLowerCase() : '';
    const kids = Array.from(node.childNodes);
    switch (tag) {
      case 'math':
      case 'mrow':
        return kids.map(mathmlToLatex).join('');
      case 'mi':
      case 'mn':
      case 'mo':
        return symOf(node.textContent);
      case 'mfrac': {
        const [n, d] = kids.filter(k => k.nodeType === 1);
        return `\\frac{${mathmlToLatex(n)}}{${mathmlToLatex(d)}}`;
      }
      case 'msup': {
        const [b, s] = kids.filter(k => k.nodeType === 1);
        return `${wrap(mathmlToLatex(b))}^{${mathmlToLatex(s)}}`;
      }
      case 'msub': {
        const [b, s] = kids.filter(k => k.nodeType === 1);
        return `${wrap(mathmlToLatex(b))}_{${mathmlToLatex(s)}}`;
      }
      case 'msubsup': {
        const [b, sub, sup] = kids.filter(k => k.nodeType === 1);
        return `${wrap(mathmlToLatex(b))}_{${mathmlToLatex(sub)}}^{${mathmlToLatex(sup)}}`;
      }
      case 'msqrt':
        return `\\sqrt{${kids.map(mathmlToLatex).join('')}}`;
      case 'mroot': {
        const [b, idx] = kids.filter(k => k.nodeType === 1);
        return `\\sqrt[${mathmlToLatex(idx)}]{${mathmlToLatex(b)}}`;
      }
      case 'mtext':
        return node.textContent;
      case 'mspace':
        return ' ';
      default:
        return kids.map(mathmlToLatex).join('');
    }
  }

  // Get LaTeX for a single mjx-container: prefer live MathJax data, else MathML fallback.
  function latexForContainer(container) {
    try {
      if (window.MathJax && window.MathJax.startup && window.MathJax.startup.document) {
        for (const math of window.MathJax.startup.document.math) {
          if (math.typesetRoot === container && math.math) {
            return math.math.trim();
          }
        }
      }
    } catch (e) { /* ignore */ }

    const mml = container.querySelector('mjx-assistive-mml math');
    if (mml) return mathmlToLatex(mml);

    const label = container.getAttribute('aria-label');
    return label ? `[${label}]` : '';
  }

  // ---------- Text extraction with math substitution ----------

  // Clone a node, replace all mjx-container with $latex$ and all <img> with
  // a bracketed URL note, return the plain text.
  function extractText(rootEl) {
    if (!rootEl) return '';
    const clone = rootEl.cloneNode(true);
    const liveContainers = rootEl.querySelectorAll('mjx-container');
    const cloneContainers = clone.querySelectorAll('mjx-container');

    cloneContainers.forEach((cEl, i) => {
      const liveEl = liveContainers[i];
      const latex = latexForContainer(liveEl || cEl);
      const isBlock = cEl.getAttribute('display') === 'true';
      const wrapped = latex ? (isBlock ? `\n$$${latex}$$\n` : `$${latex}$`) : '';
      cEl.replaceWith(clone.ownerDocument.createTextNode(wrapped));
    });

    // Images (e.g. grammar diagrams, automata drawings) — carry the URL
    // forward as text since neither clipboard nor a ?q= URL can embed
    // an actual image.
    clone.querySelectorAll('img').forEach((imgEl) => {
      const src = imgEl.getAttribute('src') || '';
      const note = src ? `\n[تصویر پیوست‌شده به سوال: ${src}]\n` : '\n[تصویر پیوست‌شده به سوال]\n';
      imgEl.replaceWith(clone.ownerDocument.createTextNode(note));
    });

    // Collapse excess whitespace but keep paragraph breaks reasonable
    let text = clone.innerText || clone.textContent || '';
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return text;
  }

  // ---------- Per-question copy logic ----------

  function buildQuestionText(questionCard) {
    const parts = [];

    // Question number + prompt. NOTE: on /me/questions the prompt div has
    // no question-content-* class, so fall back to the second child of the
    // header row (the first child is the number badge).
    const headerRow = questionCard.querySelector('.flex.gap-1\\.5');
    const numEl = headerRow ? headerRow.querySelector('span.text-black') : null;
    let promptEl = headerRow
        ? headerRow.querySelector('.question-content-rtl, .question-content-ltr')
        : null;
    if (!promptEl && headerRow && headerRow.children.length > 1) {
      promptEl = headerRow.children[1];
    }
    const num = numEl ? numEl.textContent.trim() : '';
    if (promptEl) {
      parts.push(`سوال ${num}:\n${extractText(promptEl)}`);
    }

    // Options: each option row has a circular number label + option content.
    // dir can be "rtl" (Persian questions) or "ltr" (e.g. English-language
    // questions), so match either rather than assuming rtl.
    const optionRows = questionCard.querySelectorAll(
      '.bg-transparent.flex.flex-col.gap-4.pt-2.pb-8 > div[dir="rtl"], ' +
      '.bg-transparent.flex.flex-col.gap-4.pt-2.pb-8 > div[dir="ltr"]'
    );
    if (optionRows.length) {
      parts.push('\nگزینه‌ها:');
      optionRows.forEach((row) => {
        const optNumEl = row.querySelector('.size-\\[24px\\] label');
        const optNum = optNumEl ? optNumEl.textContent.trim() : '';
        const optContentEl = row.querySelector(
          '.question-content-rtl, .question-content-ltr'
        );
        const isCorrect = row.className.includes('bg-success');
        const optText = optContentEl ? extractText(optContentEl) : '';
        parts.push(`${optNum}) ${optText}${isCorrect ? '  ← پاسخ صحیح' : ''}`);
      });
    }

    // Descriptive answer: box that contains the explanation text, whether
    // currently open or closed. It's the div right after the "دیدن/بستن
    // پاسخ تشریحی" toggle row. Prefer an element carrying question-content-*
    // inside the box; if none (e.g. the /me/questions card variant), fall
    // back to the first candidate box that actually has text — the collapsed
    // h-0 placeholder is empty so it never matches.
    let explanationContentEl = null;
    let explanationBoxEl = null;
    const candidateBoxes = questionCard.querySelectorAll(
      'div.min-h-\\[48px\\], ' +
      'div.border-1.overflow-x-auto.border-black\\/5.bg-white.rounded-\\[12px\\], ' +
      'div.h-0.bg-white.rounded-\\[12px\\]'
    );
    candidateBoxes.forEach((box) => {
      const el = box.querySelector('.question-content-rtl, .question-content-ltr');
      if (el && !explanationContentEl) {
        explanationContentEl = el;
        explanationBoxEl = box;
      }
    });
    if (!explanationContentEl) {
      candidateBoxes.forEach((box) => {
        if (!explanationBoxEl && box.textContent.trim().length > 0) {
          explanationBoxEl = box;
        }
      });
    }

    if (explanationContentEl) {
      parts.push('\nپاسخ تشریحی:');
      parts.push(extractText(explanationContentEl));
    } else if (explanationBoxEl) {
      parts.push('\nپاسخ تشریحی:');
      parts.push(extractText(explanationBoxEl));
    } else {
      parts.push('\n(پاسخ تشریحی باز نشده — برای کپی کامل، ابتدا روی «دیدن پاسخ تشریحی» کلیک کنید)');
    }

    return parts.join('\n');
  }

  function copyQuestion(questionCard, btn) {
    // If explanation is collapsed, try to open it so we can grab the text.
    const toggle = questionCard.querySelector(
      '.bg-success\\/10.border-1.border-black\\/5.flex.items-center.justify-center.gap-2.rounded-\\[8px\\].py-2.cursor-pointer'
    );
    const alreadyOpen = questionCard.querySelector('div.min-h-\\[48px\\]');

    const doCopy = () => {
      const text = buildQuestionText(questionCard);
      navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      });
      const original = btn.textContent;
      btn.textContent = 'کپی شد';
      setTimeout(() => { btn.textContent = original; }, 1400);
    };

    if (!alreadyOpen && toggle) {
      toggle.click();
      // Wait a tick for the DOM/MathJax to render the explanation
      setTimeout(doCopy, 350);
    } else {
      doCopy();
    }
  }

  // ---------- "Ask AI" prompt building ----------

  const PROMPT_PREFIX =
    'لطفاً سوال، گزینه‌ها، پاسخ صحیح و پاسخ تشریحی زیر را با جزئیات و به زبان ساده و روان توضیح بده، طوری که منطق حل مسئله کاملاً روشن شود:\n\n';

  const AI_TARGETS = [
    { name: 'ChatGPT', build: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}` },
    { name: 'Claude', build: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}` },
    { name: 'DeepSeek', build: (q) => `https://chat.deepseek.com/?q=${encodeURIComponent(q)}` },
  ];

  function closeAiMenu(menu) {
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    document.removeEventListener('click', menu._outsideHandler);
  }

  function openAiMenu(questionCard, anchorBtn) {
    // Close any other open menu first (via closeAiMenu so its document
    // click listener is removed too — just detaching the node here would
    // leak a stale listener on every reopen).
    document.querySelectorAll('.userscript-ai-menu').forEach((m) => closeAiMenu(m));

    const menu = document.createElement('div');
    // Rounded white card with a soft border, matching the site's own
    // panel styling (bg-natural-white border-1 border-black/5 rounded-[16px]).
    menu.className =
      'userscript-ai-menu bg-natural-white border-1 border-black/5 rounded-[12px] overflow-hidden';
    Object.assign(menu.style, {
      position: 'absolute',
      top: '46px',
      left: '0',
      zIndex: 60,
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      minWidth: '150px',
      fontFamily: 'inherit',
    });

    AI_TARGETS.forEach(({ name, build }, idx) => {
      const item = document.createElement('button');
      item.textContent = name;
      item.className = 'text-black hover:text-primary hover:bg-primary/5';
      Object.assign(item.style, {
        display: 'block',
        width: '100%',
        padding: '10px 14px',
        background: 'transparent',
        border: 'none',
        borderBottom: idx < AI_TARGETS.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
        fontSize: '13px',
        fontFamily: 'inherit',
        textAlign: 'right',
        cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s',
      });
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const finish = () => {
          const questionText = buildQuestionText(questionCard);
          const fullPrompt = PROMPT_PREFIX + questionText;
          window.open(build(fullPrompt), '_blank');
          closeAiMenu(menu);
        };

        // Make sure explanation is expanded first, same as copy button.
        const alreadyOpen = questionCard.querySelector('div.min-h-\\[48px\\]');
        const toggle = questionCard.querySelector(
          '.bg-success\\/10.border-1.border-black\\/5.flex.items-center.justify-center.gap-2.rounded-\\[8px\\].py-2.cursor-pointer'
        );
        if (!alreadyOpen && toggle) {
          toggle.click();
          setTimeout(finish, 350);
        } else {
          finish();
        }
      });
      menu.appendChild(item);
    });

    (anchorBtn.closest('.userscript-action') || questionCard).appendChild(menu);

    menu._outsideHandler = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchorBtn) {
        closeAiMenu(menu);
      }
    };
    // Defer so the click that opened the menu doesn't immediately close it
    setTimeout(() => document.addEventListener('click', menu._outsideHandler), 0);
  }

  // Site's own button styling: a small icon in a bordered rounded-square,
  // with a text label beside it (see "سوال منتخب", "یادداشت", "گزارش مشکل").
  function makeActionButton(iconHtml, label) {
    const wrap = document.createElement('div');
    wrap.className = 'flex items-center gap-1 cursor-pointer userscript-action';
    wrap.style.cursor = 'pointer';

    const iconBtn = document.createElement('button');
    iconBtn.className = 'bg-white';
    Object.assign(iconBtn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '32px',
      height: '32px',
      borderRadius: '6px',
      border: '1px solid rgba(0,0,0,0.05)',
      color: '#111',
      cursor: 'pointer',
      flexShrink: '0',
    });
    iconBtn.innerHTML = iconHtml;

    const small = document.createElement('small');
    small.textContent = label;
    small.style.color = '#000';
    small.style.fontSize = '10px';

    wrap.appendChild(iconBtn);
    wrap.appendChild(small);
    return { wrap, iconBtn, small };
  }

  const COPY_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

  const AI_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="7" width="16" height="12" rx="3"></rect><path d="M9 12h.01M15 12h.01" stroke-linecap="round"></path><path d="M12 7V4M8 4h8" stroke-linecap="round"></path><path d="M2 13h2M20 13h2" stroke-linecap="round"></path></svg>';

  function addCopyButton(questionCard) {
    if (questionCard.querySelector('.userscript-action')) return;

    // Prefer inserting into the existing bottom action row (the one with
    // "سوال منتخب" / "یادداشت" / "گزارش مشکل") so styling matches natively.
    const actionRow = questionCard.querySelector(
      '.flex.items-center.justify-start.gap-4.md\\:gap-8'
    );

    const { wrap: copyWrap } = makeActionButton(COPY_ICON, 'کپی سوال');
    copyWrap.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyQuestion(questionCard, copyWrap.querySelector('small'));
    });

    const { wrap: aiWrap, iconBtn: aiIconBtn } = makeActionButton(AI_ICON, 'هوش مصنوعی');
    // Use the site's own primary-tint utility class for a themed accent,
    // matching how the "سوال منتخب" (starred) icon looks when active.
    aiIconBtn.classList.remove('bg-white');
    aiIconBtn.classList.add('bg-primary/10');
    aiWrap.style.position = 'relative';
    aiWrap.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAiMenu(questionCard, aiWrap);
    });

    if (actionRow) {
      actionRow.appendChild(copyWrap);
      actionRow.appendChild(aiWrap);
    } else {
      // Fallback: no action row found (layout changed) — append at the
      // bottom of the card, not floating over the content.
      const fallbackRow = document.createElement('div');
      fallbackRow.className = 'flex items-center gap-4 mt-2 userscript-fallback-row';
      fallbackRow.appendChild(copyWrap);
      fallbackRow.appendChild(aiWrap);
      questionCard.appendChild(fallbackRow);
    }
  }

  // Question cards are identified two ways depending on the page:
  //   - result/exam pages tag each card with id="question-<n>"
  //   - /me/questions renders the same card component without any id; there
  //     the card root is a bg-natural-white/rounded-[16px] wrapper that
  //     contains the prompt header row and the options container. Only the
  //     innermost matching wrapper is kept so outer layout cards never get
  //     their own buttons.
  function findQuestionCards() {
    const idCards = Array.from(document.querySelectorAll('[id^="question-"]'));
    const untagged = Array.from(
      document.querySelectorAll('.bg-natural-white.rounded-\\[16px\\].w-full.relative')
    ).filter((el) =>
      el.querySelector('.flex.gap-1\\.5') &&
      el.querySelector('.bg-transparent.flex.flex-col.gap-4.pt-2.pb-8')
    );
    const all = Array.from(new Set([...idCards, ...untagged]));
    return all.filter((el) =>
      idCards.includes(el) ||
      !all.some((other) => other !== el && el.contains(other))
    );
  }

  function scanAndAddButtons() {
    findQuestionCards().forEach(addCopyButton);
  }

  // Coalesce bursts of calls (a single React re-render can trigger many
  // MutationObserver callbacks in a row) into one scan per animation frame,
  // instead of re-querying the whole DOM for every individual mutation.
  let scanQueued = false;
  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scanAndAddButtons();
    });
  }

  // URL shapes that carry question cards worth adding buttons to:
  //   - /exam/{id}/result          (exam result / review page)
  //   - /exam/sequential/{id}      (live exam-taking page — question cards
  //                                  appear inside an answer-feedback modal
  //                                  once you submit an answer)
  //   - /exam/comprehensive/{id}   (comprehensive exam page — same card
  //                                  component as the other exam pages;
  //                                  the trailing segment is the exam id)
  //   - /me/questions              (سوالات منتخب list — same card component,
  //                                  but without id="question-<n>" attributes)
  // Used both at startup and whenever the SPA changes routes without a
  // full page load.
  function isRelevantPage() {
    return /^\/exam\/[^/]+\/result/.test(location.pathname) ||
           /^\/exam\/sequential\/[^/]+/.test(location.pathname) ||
           /^\/exam\/comprehensive\/[^/]+/.test(location.pathname) ||
           /^\/me\/questions/.test(location.pathname);
  }

  let pollInterval = null;
  function startPolling() {
    stopPolling();
    let pollCount = 0;
    pollInterval = setInterval(() => {
      if (!isRelevantPage()) { stopPolling(); return; }
      scheduleScan();
      pollCount += 1;
      if (pollCount >= 20) stopPolling(); // ~10s, then rely on the observer alone
    }, 500);
  }
  function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }

  // The question cards are rendered client-side by React/Next.js, and this
  // site navigates between pages (e.g. from /me/exams to a result page, or
  // into a live sequential exam) without a full document reload, so a
  // script that only runs once at document_idle can miss the content
  // entirely — or run on a page that doesn't have questions yet. On the
  // live exam page, question cards also appear/disappear inside a modal
  // dialog each time an answer is submitted. To handle this reliably we:
  //   1. Load the content script on the whole site (see manifest matches),
  //      not just relevant-page URLs, so it's always present to react to
  //      client-side navigation.
  //   2. Watch for URL changes (pushState/replaceState/popstate), which
  //      Next.js uses for client-side routing, and re-scan whenever the
  //      URL becomes a relevant page.
  //   3. Keep a MutationObserver running at all times to catch React
  //      re-renders (including modals mounting/unmounting), gated by
  //      isRelevantPage() so it's a no-op elsewhere.
  //   4. A short polling fallback right after a route change, as a safety
  //      net in case the observer/render timing races.
  function handlePossibleRouteChange() {
    if (isRelevantPage()) {
      scanAndAddButtons();
      startPolling();
    } else {
      stopPolling();
    }
  }

  function init() {
    handlePossibleRouteChange();

    const observer = new MutationObserver(() => {
      if (isRelevantPage()) scheduleScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Patch pushState/replaceState so we can detect SPA navigations, since
    // there's no native event for them.
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function (...args) {
      const result = origPushState.apply(this, args);
      handlePossibleRouteChange();
      return result;
    };
    history.replaceState = function (...args) {
      const result = origReplaceState.apply(this, args);
      handlePossibleRouteChange();
      return result;
    };
    window.addEventListener('popstate', handlePossibleRouteChange);
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();