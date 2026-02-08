// ==UserScript==
// @name         Coursera Manual Solver
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Solves quizzes by matching user-pasted answers to options.
// @author       You
// @match        https://www.coursera.org/learn/*/exam/*
// @match        https://www.coursera.org/learn/*/quiz/*
// @match        https://www.coursera.org/learn/*/team/*
// @match        https://www.coursera.org/learn/*/assignment-submission/*
// ==/UserScript==

(function () {
    'use strict';

    // --- UI Setup ---
    function createPanel() {
        if (document.getElementById('ai-solver-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'ai-solver-panel';
        Object.assign(panel.style, {
            position: 'fixed',
            top: '80px',
            right: '20px',
            width: '320px',
            padding: '15px',
            backgroundColor: '#1a1a1a',
            color: '#fff',
            border: '1px solid #444',
            boxShadow: '0 4px 15px rgba(0,0,0,0.6)',
            zIndex: '10001',
            borderRadius: '8px',
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: '12px'
        });

        panel.innerHTML = `
            <h3 id="solver-header" style="margin:0 0 10px 0; color:#4dabf7; border-bottom:1px solid #444; padding-bottom:5px; cursor: move; user-select: none;">
                Manual Solver
            </h3>
            <div style="margin-bottom:10px;">
                <label style="color:#aaa; font-size:11px;">Paste Answer Here:</label>
                <textarea id="answer-input" placeholder="Paste the AI's response here..."
                    style="width:95%; height:80px; margin-top:5px; padding:5px; background:#333; color:#fff; border:1px solid #555; resize:vertical; border-radius:4px; font-family:monospace; font-size:11px;"></textarea>
            </div>
            <div style="display:flex; gap:5px; margin-bottom:10px;">
                <button id="match-btn" style="flex:1; padding:10px; background:#1864ab; color:white; border:none; font-weight:bold; cursor:pointer; border-radius:4px; font-size:13px;">🎯 Match & Select</button>
                <button id="clear-btn" style="width:60px; padding:6px; background:#c92a2a; color:white; border:none; cursor:pointer; border-radius:4px;">❌</button>
            </div>
            <div style="display:flex; gap:5px; margin-bottom:10px;">
                <button id="auto-grade-btn" style="flex:1; padding:8px; background:#5c7cfa; color:white; border:none; font-weight:bold; cursor:pointer; border-radius:4px; font-size:12px;">🎓 Auto Peer Grade</button>
            </div>
            <div id="log-area" style="margin-top:10px; max-height:120px; overflow-y:auto; color:#aaa; font-family:monospace; font-size:11px; white-space:pre-wrap; background:#000; padding:5px; border-radius:4px;">Waiting for input...</div>
        `;

        document.body.appendChild(panel);

        // --- Drag Logic ---
        const header = document.getElementById('solver-header');
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            // Get current computed position
            const rect = panel.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            // Switch from right-based to left-based positioning for dragging
            panel.style.right = 'auto';
            panel.style.left = `${initialLeft}px`;
            panel.style.top = `${initialTop}px`;

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            panel.style.left = `${initialLeft + dx}px`;
            panel.style.top = `${initialTop + dy}px`;
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // --- Input Logic ---
        const inputArea = document.getElementById('answer-input');

        // Auto-match when user pastes
        inputArea.addEventListener('input', () => {
            // Small debounce or immediate? Immediate is usually fine for paste.
            matchAnswers(inputArea.value);
        });

        document.getElementById('match-btn').onclick = () => {
            matchAnswers(inputArea.value);
        };

        document.getElementById('clear-btn').onclick = () => {
            inputArea.value = '';
            log("Cleared input.");
        };

        document.getElementById('auto-grade-btn').onclick = () => {
            autoGradePeerReview();
        };
    }

    function log(msg) {
        const el = document.getElementById('log-area');
        if (!el) return;
        const time = new Date().toLocaleTimeString().split(' ')[0];
        el.innerText = `[${time}] ${msg}\n` + el.innerText;
    }

    // --- Core Logic ---
    function extractQuestions() {
        const questionsMap = new Map();
        const inputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');

        inputs.forEach(input => {
            const name = input.getAttribute('name');
            if (!name) return;

            if (!questionsMap.has(name)) {
                questionsMap.set(name, { id: name, inputs: [], options: [] });
            }

            const label = input.closest('label');
            let optText = "";
            if (label) {
                const clone = label.cloneNode(true);
                const internalInput = clone.querySelector('input');
                if (internalInput) internalInput.remove();
                optText = clone.innerText.trim();
            }
            if (!optText && input.nextElementSibling) {
                optText = input.nextElementSibling.innerText.trim();
            }
            optText = optText.replace(/\s+/g, ' ').trim();

            if (optText) {
                const qGroup = questionsMap.get(name);
                qGroup.inputs.push(input);
                qGroup.options.push(optText);
            }
        });

        // Convert map to array
        return Array.from(questionsMap.values());
    }

    function matchAnswers(text) {
        if (!text || text.trim().length < 2) return;

        const questions = extractQuestions();
        if (questions.length === 0) {
            log("❌ No questions found on page.");
            return;
        }

        const targets = text.split(/[\n|]+/).map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
        let matchCount = 0;

        questions.forEach(q => {
            q.options.forEach((opt, idx) => {
                const cleanOpt = opt.toLowerCase();
                // Check if the option text exists in the pasted text (or vice versa for fuzzy match)
                // We split targets to handle multiple answers
                const isMatch = targets.some(t => {
                    // 1. Exact-ish match
                    if (cleanOpt === t) return true;
                    // 2. Option is contained in the pasted block (common if pasting a full sentence)
                    if (t.length > 5 && t.includes(cleanOpt)) return true;
                    // 3. Pasted token is contained in the option (common if pasting keywords)
                    if (t.length > 3 && cleanOpt.includes(t)) return true;
                    return false;
                });

                if (isMatch) {
                    const input = q.inputs[idx];
                    if (!input.checked) {
                        input.click();
                        // Click label as backup
                        setTimeout(() => { if (!input.checked) input.closest('label')?.click(); }, 50);
                        matchCount++;
                        log(`✅ Selected: "${opt.substring(0, 20)}..."`);
                    }
                }
            });
        });

        if (matchCount > 0) {
            log(`🎉 Matched ${matchCount} options.`);
        } else {
            log("⚠️ No matches found for input.");
        }
    }

    function autoGradePeerReview() {
        // Peer reviews usually use standard radio inputs for grading criteria.
        // We will assume the LAST option in each group is the highest score.
        const questions = extractQuestions();
        if (questions.length === 0) {
            log("❌ No grading criteria found.");
            return;
        }

        let gradeCount = 0;
        questions.forEach(q => {
            if (q.inputs.length > 0) {
                // Select the last input which usually corresponds to max points
                const maxPointInput = q.inputs[q.inputs.length - 1];
                if (!maxPointInput.checked) {
                    maxPointInput.click();
                    // Backup click on label
                    setTimeout(() => { if (!maxPointInput.checked) maxPointInput.closest('label')?.click(); }, 50);
                    gradeCount++;
                }
            }
        });

        if (gradeCount > 0) {
            log(`🎓 Auto-graded ${gradeCount} criteria with max points.`);
        } else {
            log("⚠️ No criteria updated (already maxed?).");
        }

        // Scroll to the bottom of the page to facilitate submission
        setTimeout(() => {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }, 100);
    }

    setTimeout(createPanel, 2000);
})();
