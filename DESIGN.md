# Sabi — UI Research, Shortlist & Design Plan

Product: premium AI tutor for university students.
Workspace: empty greenfield. Stack chosen: Vite + React + TypeScript + Tailwind v4 + React Router.

Dials (TasteSkill): DESIGN_VARIANCE 6 · MOTION_INTENSITY 6 · VISUAL_DENSITY 6 (app) / 4 (landing)

Whisper: **runs in the backend**, not the browser. The client decodes a recording to 16 kHz mono PCM and posts it to `/api/asr`; `server/voice/worker.ts` runs `Xenova/whisper-small` on a worker thread with weights cached in `server/.models/`. TTS is unchanged — still the browser's `speechSynthesis`.

---

## UI Research Results

### shadcn/ui

Inspected: [ui.shadcn.com](https://ui.shadcn.com/), [blocks](https://ui.shadcn.com/blocks), [components](https://ui.shadcn.com/docs/components), [Vite install](https://ui.shadcn.com/docs/installation/vite).

Selected (as primitives, restyled to Sabi tokens — not dashboard-01):

- Button, Input, Textarea — answer modes, forms
- Progress — mastery dimensions (not a vanity KPI)
- Dialog / Sheet — mobile tutor controls, upload
- Tabs — Teach / Practice / Assess / Review
- Tooltip, Separator, Scroll Area
- Skeleton, Empty — loading / empty courses
- Command pattern — jump to topic (keyboard)
- Sidebar *pattern* — compact study rail, not the featured analytics dashboard

Reason: accessible foundation. The featured `dashboard-01` block is four metric cards + chart + table — the brief forbids that layout.

### 21st.dev

Inspected: [21st.dev](https://21st.dev/), [AI Chat](https://21st.dev/community/components/s/ai-chat), [Voice Powered Orb](https://21st.dev/@isaiahbjork/components/voice-powered-orb), voice-orb and agent collections.

Selected *ideas* (rebuilt, not copy-pasted):

- Voice-state orb (idle / listening / thinking / speaking) — product-critical
- Streaming tutor text — comprehension, not chat chrome
- Agent-dock style bottom controls on mobile — one-handed mic

Rejected:

- Voice Powered Orb as-is (ogl + microphone shader) — heavy, sandbox-blocked, mixes ASR with presentation
- Rainbow / liquid-metal / vapour heroes — marketing slop
- Generic AI chat bubbles as the tutor surface — the brief forbids chatbot wrappers
- Neon orbs, Siri clones — wrong academic register
- Agent Chat error demos — not a learning UI

### GSAP

Inspected: [docs](https://gsap.com/docs/v3/), [useGSAP](https://gsap.com/resources/React/), [ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger).

Planned:

- Landing: one timeline + ScrollTrigger pin for the learning loop (material → understand → talk → test → feedback → progress)
- `gsap.matchMedia()` + `prefers-reduced-motion`
- Tutor entrance and assessment submit → evaluation → next question
- Isolated client components; cleanup via useGSAP

### Three.js

Planned: lazy-loaded tutor orb on `/tutor` only. State uniforms (scale, glow, noise, rotation). Fallback canvas if WebGL unavailable. No 3D on dashboard or landing.

### TasteSkill

Adopted:

- No Inter, no purple gradient, no SECTION 01 labels, no emoji UI, no 3-equal-card rows
- Technical sans (Outfit) + spare serif (Newsreader) for tutor speech / course titles
- Warm off-black, brass accent (academic / West African gold), paper light theme
- Anti-center hero (split)
- Motion only for state, hierarchy, feedback
- Explicit mobile collapse per section
- Dark + light tokens

---

## Component shortlist

| Product need | Source | Component | Why | Dependencies | Use |
|---|---|---|---|---|---|
| Study navigation | shadcn pattern | Compact rail | Course / tutor / progress without SaaS chrome | none extra | YES |
| Answer input | shadcn | Textarea, Button | Theory answers, not MCQ | none | YES |
| Mastery | shadcn Progress (custom) | Multi-dimension bars | Recall / explanation / application / reasoning | none | YES |
| Mobile tutor controls | shadcn Sheet idea | Bottom dock | One-handed mic | none | YES |
| Tutor voice state | 21st concept, custom Three | Orb | Makes listening/thinking/speaking visible | three (lazy) | YES |
| Learning-loop story | GSAP ScrollTrigger | Pinned journey | Landing must not be a SaaS hero | gsap | YES |
| Streaming speech | 21st concept, custom | Tutor transcript | Captions required for a11y | none | YES |
| Generic dashboard-01 | shadcn blocks | — | Banned layout | — | NO |
| ogl VoicePoweredOrb | 21st | — | Mixes mic/ASR into visualizer; heavy | ogl | NO |

---

## Screen design plans

### Landing

1. Goal: convince a student this is a tutor, not ChatGPT with a theme.
2. Hierarchy: line “Study like you’re being taught.” → continue GET206 visual → Start learning.
3. Motion: GSAP pin of the six-step loop. Reduced motion: stacked static sections.
4. Responsive: split hero → stacked; pin disabled < 768px.
5. A11y: real buttons, skip link, captions on any motion copy.
6. Perf: no three.js, no Whisper.

### Dashboard

1. Goal: What am I learning / do I understand it / where am I weak / what next.
2. Hierarchy: Continue Thermodynamics → weak concepts → mastery map.
3. Not four stat cards.
4. Motion: 250ms reveal of continue panel only.

### Tutor (primary)

1. Goal: natural conversation about *their* notes, with visible voice state.
2. Hierarchy: orb + spoken line → student speak/type → topic + mastery.
3. Voice states: idle, listening, processing, thinking, speaking, paused, error — each distinct in motion *and* text, not colour alone.
4. Whisper: transcribed by the backend on this machine, on a worker thread.
5. Mobile: full-screen orb, large mic, transcript sheet.

### Assessment

1. Goal: test whether they understand, not whether they click an option.
2. Hierarchy: theory prompt → record or type → understanding breakdown → useful feedback.
3. Motion: submit → evaluation stages (reading / checking / comparing with notes) → result.

### Progress

1. Goal: multi-dimension mastery + next recommendation.
2. No single percentage as the whole story.

---

## Voice architecture (Whisper runs in the backend)

```
mic → MediaRecorder → decode to 16 kHz mono PCM → POST /api/asr
                         └─ server/voice/worker.ts → Xenova/whisper-small

LLM tutor → SpeechPlan { text, emotion, speed, emphasis }
         → TtsProvider.speak()
                         ├─ custom   (future)
                         └─ speechSynthesis (MVP)
```

ASR answers “what did the student say?”
TTS answers “how does the tutor sound?”
The orb never owns either.

