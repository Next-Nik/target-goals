// TARGET GOALS — APP LOGIC v2
// Phases: setup (hourglass score) → select → quarter → horizon_gap → refine → complete
//
// ── FUTURE INTEGRATION NOTE ──────────────────────────────────────────────────
// This tool and Pulse are designed to connect. Two integration points to build:
//
// 1. INPUT: Pull latest Pulse scores (pulse_entries table) as the starting point
//    for the scoring step — same way Map data is pulled from orienteering_sessions.
//    When Pulse data exists, skip the hourglass picker entirely.
//
// 2. OUTPUT: When a Target Goals session is saved (target_goal_sessions table),
//    write the three selected domains + goals back to a pulse_target_goals column
//    so Pulse can surface progress tracking in the weekly/monthly check-ins.
//
// Both tools share the same 7 domains, same user_id, same Supabase instance.
// ─────────────────────────────────────────────────────────────────────────────

const DOMAINS = [
  { id: "path",          label: "Path",          question: "Am I walking my path — or just walking?",                  description: "Your calling, contribution &amp; the work you're here to do" },
  { id: "spark",         label: "Spark",         question: "Is the fire on?",                                          description: "The animating fire — aliveness, joy, play &amp; the godspark" },
  { id: "body",          label: "Body",          question: "How is this living system doing?",                         description: "Physical vitality, health, energy &amp; embodiment" },
  { id: "finances",      label: "Finances",      question: "Do I have the agency to act on what matters?",             description: "Your relationship with money, resources &amp; abundance" },
  { id: "relationships", label: "Relationships", question: "Am I truly known by anyone?",                              description: "Intimacy, friendship, community &amp; belonging" },
  { id: "inner_game",    label: "Inner Game",    question: "Are my stories tending me, or running me?",                description: "Your relationship with yourself — beliefs, values &amp; self-trust" },
  { id: "outer_game",    label: "Outer Game",    question: "Is what I'm broadcasting aligned with who I actually am?", description: "How you show up in the world — presence, expression &amp; public identity" },
];

const TIER_LABELS = {
  10: "World-Class", 9: "Exemplar", 8: "Fluent",   7: "Capable",
  6:  "Functional",  5: "Threshold", 4: "Friction", 3: "Strain",
  2:  "Crisis",      1: "Emergency", 0: "Ground Zero"
};

function getTierColor(n) {
  if (n >= 9) return "#3B6B9E";
  if (n >= 7) return "#5A8AB8";
  if (n >= 5) return "#8A8070";
  if (n >= 3) return "#8A7030";
  return "#8A3030";
}

// ── STATE ─────────────────────────────────────────────────────────────────────
const App = {
  phase: "setup",
  mapData: null,
  scores: {},
  hasMapData: false,
  selectedDomains: [],
  quarterType: null,
  targetDate: null,
  endDateLabel: null,
  completedDomains: [],
  currentDomainIndex: 0,
  messages: [],
  sessionId: null,
  userId: null,
  isWaiting: false,
  recommendation: null,
  activeDomain: 0,
  showScoreSummary: false,
  horizonGapData: {},
  horizonGapIndex: 0,

  init() {
    this.loadMapData();
    this.render();
  },

  async loadMapData() {
    const sb = window._supabase;
    if (!sb) return;
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      this.userId = user.id;
      const { data } = await sb
        .from('orienteering_sessions')
        .select('session, completed_at')
        .eq('user_id', user.id)
        .eq('complete', true)
        .order('updated_at', { ascending: false })
        .limit(1).maybeSingle();
      if (data?.session?.domainData) {
        this.mapData = data.session;
        this.hasMapData = true;
        Object.entries(data.session.domainData).forEach(([id, d]) => {
          if (d.score !== undefined) this.scores[id] = d.score;
        });
        this.render();
      }
    } catch (e) {
      console.warn('[TargetGoals] Could not load Map data:', e);
    }
  },

  render() {
    const app = document.getElementById('app');
    if (!app) return;
    if (this.phase === "setup")       { app.innerHTML = this.renderSetup();      this.bindSetup(); }
    if (this.phase === "select")      { app.innerHTML = this.renderSelect();     this.bindSelect(); }
    if (this.phase === "quarter")     { app.innerHTML = this.renderQuarter();    this.bindQuarter(); }
    if (this.phase === "horizon_gap") { app.innerHTML = this.renderHorizonGap(); this.bindHorizonGap(); }
    if (this.phase === "refine")      { app.innerHTML = this.renderRefine();     this.bindRefine(); }
    if (this.phase === "complete")    { app.innerHTML = this.renderComplete();   this.bindComplete(); }
  },

  // ── HOURGLASS PICKER ──────────────────────────────────────────────────────────
  renderHourglassPicker(domainIndex) {
    const d = DOMAINS[domainIndex];
    const numbers = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const minW = 38, maxW = 100;
    const getWidth = (n) => {
      const pct = Math.pow((n - 5) / 5, 2);
      return Math.round(minW + (maxW - minW) * pct);
    };

    const rows = numbers.map(n => {
      const col = getTierColor(n);
      const w = getWidth(n);
      const isThreshold = n === 5;
      const tier = TIER_LABELS[n];
      return `
        <div class="hourglass-row">
          <div class="hourglass-num${isThreshold ? ' hourglass-threshold' : ''}">${n}</div>
          <div class="hourglass-bar-wrap">
            <div class="hourglass-stub hourglass-stub-left"></div>
            <div class="hourglass-stub hourglass-stub-right"></div>
            <button class="hourglass-bar"
              data-score="${n}" data-domain="${d.id}" data-col="${col}"
              style="width:${w}%;background:${col}20;border:1px solid ${col}44;"
              aria-label="${d.label} score ${n}"
            ></button>
          </div>
          <div class="hourglass-tier${isThreshold ? ' hourglass-threshold' : ''}" style="color:${isThreshold ? '#A8721A' : col};">${isThreshold ? '&#8212; Threshold' : tier}</div>
        </div>`;
    }).join('');

    return `<div class="hourglass-picker">${rows}</div>`;
  },

  // ── PULSE WHEEL (SVG) ─────────────────────────────────────────────────────────
  renderPulseWheel(scores, size) {
    size = size || 260;
    const cx = size / 2, cy = size / 2;
    const maxR = (size / 2) * 0.72;
    const n = DOMAINS.length;

    function getPoint(i, val) {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = (val / 10) * maxR;
      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    }

    const rings = [2, 4, 6, 8, 10].map(v => {
      const pts = DOMAINS.map((_, i) => getPoint(i, v).join(',')).join(' ');
      return `<polygon points="${pts}" fill="none" stroke="rgba(200,146,42,0.10)" stroke-width="1"/>`;
    }).join('');

    const axes = DOMAINS.map((_, i) => {
      const [x, y] = getPoint(i, 10);
      return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(200,146,42,0.12)" stroke-width="1"/>`;
    }).join('');

    const polyPts = DOMAINS.map((d, i) => {
      const s = (scores[d.id] !== undefined && scores[d.id] !== null) ? scores[d.id] : 5;
      return getPoint(i, s).join(',');
    }).join(' ');

    const scoredVals = Object.values(scores).filter(v => v !== undefined && v !== null);
    const avgScore = scoredVals.length > 0
      ? (scoredVals.reduce((a, b) => a + b, 0) / scoredVals.length).toFixed(1)
      : null;
    const avgColor = avgScore ? getTierColor(parseFloat(avgScore)) : '#A8721A';

    const labels = DOMAINS.map((d, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = maxR + 20;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      const s = scores[d.id];
      const col = (s !== undefined && s !== null) ? getTierColor(s) : 'rgba(15,21,35,0.45)';
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle"
        font-family="'Cormorant SC',Georgia,serif" font-size="9" font-weight="600"
        letter-spacing="1" fill="${col}">${d.label.toUpperCase()}</text>`;
    }).join('');

    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block;">
          ${rings}${axes}
          <polygon points="${polyPts}" fill="rgba(200,146,42,0.12)" stroke="rgba(200,146,42,0.78)" stroke-width="1.5"/>
          ${labels}
        </svg>
        ${avgScore ? `<div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:14px;color:${avgColor};font-weight:600;">${avgScore} &middot; ${TIER_LABELS[Math.round(parseFloat(avgScore))] || ''}</div>` : ''}
      </div>`;
  },

  // ── PHASE: SETUP ─────────────────────────────────────────────────────────────
  renderSetup() {
    if (this.hasMapData) {
      setTimeout(() => { this.phase = "select"; this.render(); }, 0);
      return '<div class="body-text" style="text-align:center;padding:60px 0;">Loading your Map data...</div>';
    }

    const d = DOMAINS[this.activeDomain];
    const scoredCount = DOMAINS.filter(dom => this.scores[dom.id] !== undefined).length;
    const allScored = scoredCount === DOMAINS.length;

    if (this.showScoreSummary) {
      const summaryCards = DOMAINS.map(dom => {
        const s = this.scores[dom.id];
        const col = getTierColor(s);
        return `<div class="score-summary-card" style="border-color:${col}44;background:${col}14;">
          <div class="score-summary-label">${dom.label}</div>
          <div class="score-summary-num" style="color:${col};">${s}</div>
          <div class="score-summary-tier" style="color:${col};">${TIER_LABELS[s]}</div>
        </div>`;
      }).join('');

      return `
        <span class="eyebrow">Life OS &middot; Target Goals</span>
        <h1>Your starting point.</h1>
        <div class="rule"></div>
        <p class="body-text">This is where you are right now. Honest is better than aspirational.</p>
        <div style="display:flex;justify-content:center;margin-bottom:28px;">
          ${this.renderPulseWheel(this.scores, 260)}
        </div>
        <div class="score-summary-grid">${summaryCards}</div>
        <div style="display:flex;gap:12px;margin-top:8px;">
          <button class="btn btn-ghost" id="backToPickerBtn">&#8592; Adjust</button>
          <button class="btn" id="toSelectBtn" style="flex:1;">Choose my focus areas &#8594;</button>
        </div>`;
    }

    const tabs = DOMAINS.map((dom, i) => {
      const s = this.scores[dom.id];
      const isActive = i === this.activeDomain;
      const isScored = s !== undefined;
      const col = isScored ? getTierColor(s) : null;
      return `<button class="domain-tab${isActive ? ' active' : ''}${isScored ? ' scored' : ''}"
        data-idx="${i}"
        style="${isScored ? `color:${col};border-color:${col}44;background:${col}14;` : ''}"
      >${dom.label}${isScored ? ` &middot; ${s}` : ''}</button>`;
    }).join('');

    return `
      <span class="eyebrow">Life OS &middot; Target Goals</span>
      <h1>Where are you right now?</h1>
      <div class="rule"></div>
      <p class="body-text">Rate yourself honestly across all seven areas. 0 is serious trouble. 10 is exactly where you want to be.</p>

      <div style="display:flex;justify-content:center;margin-bottom:20px;">
        ${this.renderPulseWheel(this.scores, 220)}
      </div>

      <div class="domain-tab-strip">${tabs}</div>

      <div style="margin-bottom:12px;">
        <div style="font-family:'Cormorant SC',Georgia,serif;font-size:16px;font-weight:600;letter-spacing:0.12em;color:#0F1523;margin-bottom:4px;">${d.label}</div>
        <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:14px;font-style:italic;color:rgba(15,21,35,0.88);line-height:1.6;">${d.description}</div>
      </div>

      <div class="hourglass-wrap">${this.renderHourglassPicker(this.activeDomain)}</div>

      <div style="margin-top:20px;display:flex;align-items:center;justify-content:space-between;">
        <span style="font-family:'Cormorant SC',Georgia,serif;font-size:11px;letter-spacing:0.14em;color:rgba(15,21,35,0.72);">${scoredCount} OF 7</span>
        ${allScored ? `<button class="btn" id="toSummaryBtn">Review &#8594;</button>` : ''}
      </div>`;
  },

  bindSetup() {
    document.querySelectorAll('.hourglass-bar').forEach(btn => {
      const col = btn.dataset.col;
      btn.addEventListener('mouseenter', () => {
        btn.style.background = col;
        btn.style.borderColor = col;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = `${col}20`;
        btn.style.borderColor = `${col}44`;
      });
      btn.addEventListener('click', () => {
        const domainId = btn.dataset.domain;
        const score = parseInt(btn.dataset.score);
        this.scores[domainId] = score;
        const currentIdx = DOMAINS.findIndex(d => d.id === domainId);
        const nextIdx = DOMAINS.findIndex((d, i) => i > currentIdx && this.scores[d.id] === undefined);
        if (nextIdx !== -1) {
          this.activeDomain = nextIdx;
        }
        this.render();
      });
    });

    document.querySelectorAll('.domain-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeDomain = parseInt(btn.dataset.idx);
        this.render();
      });
    });

    document.getElementById('toSummaryBtn')?.addEventListener('click', () => {
      this.showScoreSummary = true;
      this.render();
    });

    document.getElementById('backToPickerBtn')?.addEventListener('click', () => {
      this.showScoreSummary = false;
      this.activeDomain = 0;
      this.render();
    });

    document.getElementById('toSelectBtn')?.addEventListener('click', () => {
      this.showScoreSummary = false;
      this.phase = "select";
      this.render();
      this.getRecommendation();
    });
  },

  // ── PHASE: SELECT ────────────────────────────────────────────────────────────
  async getRecommendation() {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'recommend', scores: this.scores, hasMapData: this.hasMapData })
      });
      this.recommendation = await res.json();
      this.render();
    } catch (e) {
      console.warn('[TargetGoals] Recommendation failed:', e);
    }
  },

  renderSelect() {
    const rec = this.recommendation;
    const cards = DOMAINS.map(d => {
      const selected  = this.selectedDomains.includes(d.id);
      const isRec     = rec?.recommended?.includes(d.id);
      const rationale = rec?.rationale?.[d.id];
      const score     = this.scores[d.id];
      const disabled  = !selected && this.selectedDomains.length >= 3;
      const col       = score !== undefined ? getTierColor(score) : null;

      return `
        <div class="domain-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}"
             data-id="${d.id}" role="button" tabindex="0">
          <div class="domain-name">${d.label}${isRec ? ' &#10022;' : ''}</div>
          <div class="domain-question">${rationale || d.question}</div>
          ${score !== undefined ? `
            <div class="domain-score-bar">
              <div class="domain-score-fill" style="width:${score * 10}%;background:${col};"></div>
            </div>
            <div class="domain-score-label" style="color:${col};">${score} &middot; ${TIER_LABELS[score]}</div>
          ` : ''}
        </div>`;
    }).join('');

    const obs = rec?.soft_observation;
    const canContinue = this.selectedDomains.length === 3;

    return `
      <span class="eyebrow">Phase 1 &middot; Focus Areas</span>
      <h1>Choose three areas.</h1>
      <div class="rule"></div>
      <p class="body-text">
        ${this.hasMapData
          ? 'These are your seven Life OS domains. The &#10022; mark shows what the AI suggests based on your Map. Choose three &#8212; you have the final say.'
          : 'Choose the three areas where focused effort over the next quarter would matter most.'}
      </p>
      ${obs ? `<div class="soft-warning">${obs}</div>` : ''}
      <div class="domain-grid">${cards}</div>
      <button class="btn" id="toQuarterBtn" ${canContinue ? '' : 'disabled'}>
        Set my quarter &#8594;
      </button>`;
  },

  bindSelect() {
    document.querySelectorAll('.domain-card:not(.disabled)').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        if (this.selectedDomains.includes(id)) {
          this.selectedDomains = this.selectedDomains.filter(x => x !== id);
        } else if (this.selectedDomains.length < 3) {
          this.selectedDomains.push(id);
        }
        this.render();
      });
    });
    document.getElementById('toQuarterBtn')?.addEventListener('click', () => {
      this.phase = "quarter";
      this.render();
    });
  },

  // ── PHASE: QUARTER ───────────────────────────────────────────────────────────
  renderQuarter() {
    const today = new Date();
    const rolling = new Date(today);
    rolling.setDate(rolling.getDate() + 90);
    const month = today.getMonth();
    let qEnd;
    if (month < 3)       qEnd = new Date(today.getFullYear(), 2, 31);
    else if (month < 6)  qEnd = new Date(today.getFullYear(), 5, 30);
    else if (month < 9)  qEnd = new Date(today.getFullYear(), 8, 30);
    else                 qEnd = new Date(today.getFullYear(), 11, 31);

    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const qLabel = month < 3 ? 'Q1' : month < 6 ? 'Q2' : month < 9 ? 'Q3' : 'Q4';
    const calDays = Math.round((qEnd - today) / (1000 * 60 * 60 * 24));

    this._rollingDate = rolling;
    this._calDate = qEnd;
    this._rollingLabel = `90 days &#8212; ${fmt(rolling)}`;
    this._calLabel = `${qLabel} end &#8212; ${fmt(qEnd)} (${calDays} days)`;

    return `
      <span class="eyebrow">Phase 1 &middot; Timeline</span>
      <h2>When does this quarter end?</h2>
      <div class="rule"></div>
      <p class="body-text">Choose a target date. Both work &#8212; this is about what rhythm fits your life.</p>
      <div class="quarter-options">
        <div class="quarter-option ${this.quarterType === 'rolling' ? 'selected' : ''}" data-type="rolling">
          <div class="quarter-option-title">Rolling 90 days</div>
          <div class="quarter-option-date">${fmt(rolling)}</div>
          <div class="quarter-option-desc">Starts today. 90 days of focused movement.</div>
        </div>
        <div class="quarter-option ${this.quarterType === 'calendar' ? 'selected' : ''}" data-type="calendar">
          <div class="quarter-option-title">Calendar quarter</div>
          <div class="quarter-option-date">${fmt(qEnd)}</div>
          <div class="quarter-option-desc">${qLabel} end &#8212; syncs with how the year flows.</div>
        </div>
      </div>
      <button class="btn" id="toHorizonGapBtn" ${this.quarterType ? '' : 'disabled'}>
        Set my targets &#8594;
      </button>`;
  },

  bindQuarter() {
    document.querySelectorAll('.quarter-option').forEach(opt => {
      opt.addEventListener('click', () => {
        this.quarterType = opt.dataset.type;
        if (this.quarterType === 'rolling') {
          this.targetDate   = this._rollingDate.toISOString().slice(0, 10);
          this.endDateLabel = this._rollingLabel;
        } else {
          this.targetDate   = this._calDate.toISOString().slice(0, 10);
          this.endDateLabel = this._calLabel;
        }
        this.render();
      });
    });
    document.getElementById('toHorizonGapBtn')?.addEventListener('click', () => {
      this.phase = "horizon_gap";
      this.horizonGapIndex = 0;
      this.horizonGapData = {};
      this.render();
    });
  },

  // ── PHASE: HORIZON GAP ───────────────────────────────────────────────────────
  renderHorizonGap() {
    const total    = this.selectedDomains.length;
    const domainId = this.selectedDomains[this.horizonGapIndex];
    const domain   = DOMAINS.find(d => d.id === domainId);
    const current  = this.horizonGapIndex + 1;
    const existing = this.horizonGapData[domainId] || {};
    const score    = this.scores[domainId];
    const col      = score !== undefined ? getTierColor(score) : '#A8721A';

    const completedSummaries = this.selectedDomains.slice(0, this.horizonGapIndex).map(id => {
      const d   = DOMAINS.find(x => x.id === id);
      const gap = this.horizonGapData[id];
      return `
        <div class="goal-card" style="margin-bottom:14px;opacity:0.75;">
          <div class="goal-card-domain">${d?.label} &#10003;</div>
          <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:14px;font-style:italic;color:rgba(15,21,35,0.88);line-height:1.55;">${gap?.gap || ''}</div>
        </div>`;
    }).join('');

    return `
      ${completedSummaries}
      <span class="eyebrow">Horizon Gap &middot; ${current} of ${total}</span>
      <h2>${domain?.label}</h2>
      <div class="rule"></div>
      <p class="body-text">Before we build the goal, let's name what's actually true &#8212; and what's in the way.</p>

      ${score !== undefined ? `
        <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:40px;border:1.5px solid ${col}44;background:${col}14;margin-bottom:24px;">
          <span style="font-family:'Cormorant SC',Georgia,serif;font-size:11px;letter-spacing:0.12em;color:${col};">${score} &middot; ${TIER_LABELS[score]}</span>
        </div>
      ` : ''}

      <div style="margin-bottom:20px;">
        <label class="eyebrow" style="font-size:11px;margin-bottom:8px;display:block;">Where are you honestly, right now?</label>
        <textarea class="edit-textarea" id="horizonCurrent" rows="3"
          placeholder="Describe your current reality in this area. Not where you want to be &#8212; where you actually are."
        >${existing.current || ''}</textarea>
      </div>

      <div style="margin-bottom:28px;">
        <label class="eyebrow" style="font-size:11px;margin-bottom:8px;display:block;">What's the gap &#8212; what's actually in the way?</label>
        <textarea class="edit-textarea" id="horizonGapInput" rows="3"
          placeholder="What pattern, belief, habit, or circumstance is holding you at ${score !== undefined ? score : '?'}/10?"
        >${existing.gap || ''}</textarea>
      </div>

      <div style="display:flex;gap:12px;">
        ${this.horizonGapIndex > 0 ? `<button class="btn btn-ghost" id="horizonBackBtn">&#8592; Back</button>` : ''}
        <button class="btn" id="horizonNextBtn" style="flex:1;">
          ${current < total ? 'Next domain &#8594;' : 'Build my goals &#8594;'}
        </button>
      </div>`;
  },

  bindHorizonGap() {
    document.getElementById('horizonNextBtn')?.addEventListener('click', () => {
      const domainId = this.selectedDomains[this.horizonGapIndex];
      const current  = document.getElementById('horizonCurrent')?.value?.trim() || '';
      const gap      = document.getElementById('horizonGapInput')?.value?.trim() || '';
      this.horizonGapData[domainId] = { current, gap };

      if (this.horizonGapIndex < this.selectedDomains.length - 1) {
        this.horizonGapIndex++;
        this.render();
      } else {
        this.phase = "refine";
        this.currentDomainIndex = 0;
        this.messages = [];
        this.render();
        this.startRefinement();
      }
    });

    document.getElementById('horizonBackBtn')?.addEventListener('click', () => {
      const domainId = this.selectedDomains[this.horizonGapIndex];
      const current  = document.getElementById('horizonCurrent')?.value?.trim() || '';
      const gap      = document.getElementById('horizonGapInput')?.value?.trim() || '';
      this.horizonGapData[domainId] = { current, gap };
      this.horizonGapIndex--;
      this.render();
    });
  },

  // ── PHASE: REFINE ────────────────────────────────────────────────────────────
  renderRefine() {
    const domain      = DOMAINS.find(d => d.id === this.selectedDomains[this.currentDomainIndex]);
    const domainLabel = domain?.label || '';
    const total       = this.selectedDomains.length;
    const current     = this.currentDomainIndex + 1;

    const msgs = this.messages.map(m => {
      if (m.role === 'assistant') return `<div class="msg-assistant">${m.content.replace(/\n/g, '<br>')}</div>`;
      if (m.role === 'user')      return `<div class="msg-user">${m.content}</div>`;
      if (m.role === 'system')    return `<div class="msg-system">${m.content}</div>`;
      return '';
    }).join('');

    const typing = this.isWaiting
      ? `<div class="typing"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>` : '';

    const completedSummaries = this.completedDomains.map(d => {
      const dl = DOMAINS.find(x => x.id === d.domain);
      return `
        <div class="goal-card" style="margin-bottom:14px;">
          <div class="goal-card-domain">${dl?.label || d.domain} &#10003;</div>
          <div class="goal-card-outcome">${d.outcome_user || d.outcome_system}</div>
        </div>`;
    }).join('');

    return `
      ${completedSummaries}
      <span class="eyebrow">Area ${current} of ${total} &middot; ${domainLabel}</span>
      <h2>Let's build your ${domainLabel} goal.</h2>
      <div class="rule"></div>
      <div class="chat-area" id="chatArea">${msgs}${typing}</div>
      <div class="inline-input-wrap">
        <textarea class="input-field" id="userInput"
          placeholder="Write your response here..."
          rows="3"
          ${this.isWaiting ? 'disabled' : ''}
        ></textarea>
        <div class="inline-input-actions">
          <button class="send-btn" id="sendBtn" ${this.isWaiting ? 'disabled' : ''}>Send &#8594;</button>
        </div>
      </div>`;
  },

  bindRefine() {
    const input   = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const send = () => {
      const text = input?.value?.trim();
      if (!text || this.isWaiting) return;
      input.value = '';
      input.style.height = 'auto';
      this.sendMessage(text);
    };
    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    });
    sendBtn?.addEventListener('click', send);
  },

  async startRefinement() {
    const domainId   = this.selectedDomains[this.currentDomainIndex];
    const score      = this.scores[domainId];
    const domainData = this.mapData?.domainData?.[domainId];
    const horizonGap = this.horizonGapData[domainId];

    this.messages = [];
    this.isWaiting = true;
    this.render();
    this.bindRefine();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'refine',
          domain: domainId,
          domainScore: domainData?.placement || null,
          currentScore: score,
          targetDate: this.endDateLabel,
          horizonCurrent: horizonGap?.current || null,
          horizonGap: horizonGap?.gap || null,
          messages: [{ role: 'user', content: 'START' }],
          completedDomains: this.completedDomains
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      const data = await res.json();
      this.isWaiting = false;
      if (data.message) {
        this.messages = [{ role: 'assistant', content: data.message }];
      }
    } catch (e) {
      this.isWaiting = false;
      this.messages = [{ role: 'assistant', content: "Something went wrong reaching the server. Please refresh and try again." }];
    }

    this.render();
    this.bindRefine();
    this.scrollChat();
  },

  async sendMessage(text) {
    this.messages.push({ role: 'user', content: text });
    this.isWaiting = true;
    this.render();
    this.bindRefine();
    this.scrollChat();

    const domainId   = this.selectedDomains[this.currentDomainIndex];
    const score      = this.scores[domainId];
    const domainData = this.mapData?.domainData?.[domainId];
    const horizonGap = this.horizonGapData[domainId];

    const apiMessages = this.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));

    let data;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'refine',
          domain: domainId,
          domainScore: domainData?.placement || null,
          currentScore: score,
          targetDate: this.endDateLabel,
          horizonCurrent: horizonGap?.current || null,
          horizonGap: horizonGap?.gap || null,
          messages: apiMessages,
          completedDomains: this.completedDomains
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      data = await res.json();
    } catch (e) {
      this.isWaiting = false;
      this.messages.push({ role: 'assistant', content: "Something went wrong. Please try sending that again." });
      this.render();
      this.bindRefine();
      this.scrollChat();
      return;
    }
    this.isWaiting = false;

    if (data.complete && data.data) {
      this.saveGoal(domainId, data.data);
    } else if (data.message) {
      this.messages.push({ role: 'assistant', content: data.message });
      this.render();
      this.bindRefine();
      this.scrollChat();
    }
  },

  saveGoal(domainId, goalData) {
    const goal = {
      domain:               domainId,
      outcome_system:       goalData.outcome_system,
      outcome_user:         null,
      month3:               goalData.month3,
      month2:               goalData.month2,
      month1:               goalData.month1,
      month3_why:           goalData.month3_why || null,
      month2_why:           goalData.month2_why || null,
      month1_why:           goalData.month1_why || null,
      weeks:                goalData.weeks,
      tea:                  goalData.tea,
      conversation_insight: goalData.conversation_insight,
      horizon_gap:          this.horizonGapData[domainId] || null,
    };
    this.completedDomains.push(goal);

    if (this.currentDomainIndex < this.selectedDomains.length - 1) {
      this.currentDomainIndex++;
      this.messages = [];
      this.phase = "refine";
      this.render();
      this.startRefinement();
    } else {
      this.phase = "complete";
      this.saveToSupabase();
      this.render();
      this.bindComplete();
    }
  },

  scrollChat() {
    setTimeout(() => {
      const area = document.getElementById('chatArea');
      if (area) area.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      else window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }, 100);
  },

  // ── PHASE: COMPLETE ──────────────────────────────────────────────────────────
  renderComplete() {
    const goals = this.completedDomains.map(d => {
      const dl      = DOMAINS.find(x => x.id === d.domain);
      const outcome = d.outcome_user || d.outcome_system;
      const score   = this.scores[d.domain];
      const col     = score !== undefined ? getTierColor(score) : '#A8721A';

      const milestones = `
        <div class="goal-card-milestones">
          <div class="milestone">
            <span class="milestone-label">Month 3</span>
            <div><div class="milestone-text">${d.month3}</div>${d.month3_why ? `<div class="milestone-why">${d.month3_why}</div>` : ''}</div>
          </div>
          <div class="milestone">
            <span class="milestone-label">Month 2</span>
            <div><div class="milestone-text">${d.month2}</div>${d.month2_why ? `<div class="milestone-why">${d.month2_why}</div>` : ''}</div>
          </div>
          <div class="milestone">
            <span class="milestone-label">Month 1</span>
            <div><div class="milestone-text">${d.month1}</div>${d.month1_why ? `<div class="milestone-why">${d.month1_why}</div>` : ''}</div>
          </div>
        </div>`;

      const tea = d.tea ? `
        <div class="tea-section">
          <span class="tea-label">Daily T.E.A.</span>
          <div class="tea-anchor"><span class="tea-type">Thoughts</span><span class="tea-text">${d.tea.thoughts}</span></div>
          <div class="tea-anchor"><span class="tea-type">Emotions</span><span class="tea-text">${d.tea.emotions}</span></div>
          <div class="tea-anchor"><span class="tea-type">Actions</span><span class="tea-text">${d.tea.actions}</span></div>
        </div>` : '';

      const horizonGapDisplay = d.horizon_gap?.gap ? `
        <div style="margin:14px 0;padding:12px 16px;border-radius:10px;background:rgba(200,146,42,0.04);border:1px solid rgba(200,146,42,0.20);">
          <div style="font-family:'Cormorant SC',Georgia,serif;font-size:11px;letter-spacing:0.14em;color:rgba(15,21,35,0.72);margin-bottom:4px;">HORIZON GAP</div>
          <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:14px;font-style:italic;color:rgba(15,21,35,0.88);line-height:1.6;">${d.horizon_gap.gap}</div>
        </div>` : '';

      const editSection = `
        <div style="margin-top:16px;">
          <button class="edit-toggle" data-domain="${d.domain}">
            ${d.outcome_user ? 'Your version saved &#10003; &#8212; edit again' : 'Edit this goal &#8594;'}
          </button>
          <div class="edit-overlay" id="edit-${d.domain}">
            <textarea class="edit-textarea" placeholder="Write your own version of this goal..."
              data-domain="${d.domain}">${d.outcome_user || d.outcome_system}</textarea>
            <p class="edit-hint">Your version leads. The AI's version stays accessible behind this.</p>
            ${d.outcome_system !== d.outcome_user && d.outcome_user
              ? `<p class="edit-hint" style="margin-top:6px;">AI suggested: "${d.outcome_system}"</p>` : ''}
            <button class="btn" style="margin-top:12px;padding:10px 24px;font-size:13px;"
              data-save-domain="${d.domain}">Save my version &#8594;</button>
          </div>
        </div>`;

      return `
        <div class="goal-card">
          <div class="goal-card-domain" style="color:${col};">${dl?.label}</div>
          ${score !== undefined ? `<div style="font-family:'Cormorant SC',Georgia,serif;font-size:11px;letter-spacing:0.10em;color:${col};margin-bottom:10px;">${score} &middot; ${TIER_LABELS[score]}</div>` : ''}
          <div class="goal-card-outcome">${outcome}</div>
          ${horizonGapDisplay}
          ${milestones}
          ${tea}
          ${editSection}
        </div>`;
    }).join('');

    return `
      <div class="completion-header">
        <span class="completion-glyph">&#10022;</span>
        <span class="eyebrow">Quarter set</span>
        <h1>${this.endDateLabel || '90 days ahead'}</h1>
        <p class="body-text" style="max-width:480px;margin:0 auto;">
          The goal is not the point &#8212; what you become moving toward it is.
          Three areas. One quarter. Let's see what moves.
        </p>
      </div>
      ${goals}
      ${this.renderCalendarLinks()}
      <div style="text-align:center;margin-top:40px;">
        <a href="https://nextus.world/profile.html" class="btn">Go to your profile &#8594;</a>
      </div>`;
  },

  // ── CALENDAR LINKS ────────────────────────────────────────────────────────────
  renderCalendarLinks() {
    if (!this.targetDate || !this.completedDomains.length) return '';

    const fmtDate = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}${m}${day}`;
    };

    const events = [];
    this.completedDomains.forEach(d => {
      const dl   = DOMAINS.find(x => x.id === d.domain);
      const label = dl?.label || d.domain;
      const base  = new Date(this.targetDate);
      const m1Date = new Date(base); m1Date.setDate(m1Date.getDate() - 60);
      const m2Date = new Date(base); m2Date.setDate(m2Date.getDate() - 30);
      const m3Date = new Date(base);
      events.push({ label: `${label} &#8212; Month 1`, text: d.month1, date: m1Date });
      events.push({ label: `${label} &#8212; Month 2`, text: d.month2, date: m2Date });
      events.push({ label: `${label} &#8212; Month 3`, text: d.month3, date: m3Date });
    });

    const googleLinks = events.map(e => {
      const dt      = fmtDate(e.date);
      const title   = encodeURIComponent(`Life OS: ${e.label.replace(/&#8212;/g, '-')}`);
      const details = encodeURIComponent(e.text || '');
      return `<a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dt}/${dt}&details=${details}" target="_blank" rel="noopener" class="cal-link">${e.label}</a>`;
    }).join('');

    const appleLinks = events.map(e => {
      const dt      = fmtDate(e.date);
      const title   = encodeURIComponent(`Life OS: ${e.label.replace(/&#8212;/g, '-')}`);
      const details = encodeURIComponent(e.text || '');
      return `<a href="webcal://calendar.apple.com/calendar/event?title=${title}&start-date=${dt}&notes=${details}" class="cal-link">${e.label}</a>`;
    }).join('');

    return `
      <div class="goal-card" style="margin-top:32px;">
        <div class="goal-card-domain">Add milestones to your calendar</div>
        <p style="font-family:'Cormorant Garamond',Georgia,serif;font-size:15px;color:rgba(15,21,35,0.88);line-height:1.65;margin-bottom:20px;">
          Each milestone opens pre-filled in your calendar app. One tap, done.
        </p>
        <div class="cal-tabs">
          <button class="cal-tab active" data-cal="google">Google Calendar</button>
          <button class="cal-tab" data-cal="apple">Apple Calendar</button>
        </div>
        <div class="cal-links-list" id="calGoogle">${googleLinks}</div>
        <div class="cal-links-list" id="calApple" style="display:none;">${appleLinks}</div>
      </div>`;
  },

  bindComplete() {
    document.querySelectorAll('.edit-toggle[data-domain]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById(`edit-${btn.dataset.domain}`)?.classList.toggle('open');
      });
    });
    document.querySelectorAll('[data-save-domain]').forEach(btn => {
      btn.addEventListener('click', () => {
        const domainId = btn.dataset.saveDomain;
        const textarea = document.querySelector(`.edit-textarea[data-domain="${domainId}"]`);
        const value    = textarea?.value?.trim();
        if (!value) return;
        const goal = this.completedDomains.find(d => d.domain === domainId);
        if (goal) { goal.outcome_user = value; this.saveToSupabase(); this.showToast('Saved'); }
        document.getElementById(`edit-${domainId}`)?.classList.remove('open');
        this.render();
        this.bindComplete();
      });
    });
    document.querySelectorAll('.cal-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.cal-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const cal = tab.dataset.cal;
        const gEl = document.getElementById('calGoogle');
        const aEl = document.getElementById('calApple');
        if (gEl) gEl.style.display = cal === 'google' ? 'flex' : 'none';
        if (aEl) aEl.style.display = cal === 'apple'  ? 'flex' : 'none';
      });
    });
  },

  // ── SUPABASE ─────────────────────────────────────────────────────────────────
  async saveToSupabase() {
    const sb = window._supabase;
    if (!sb || !this.userId) return;
    const sessionData = {
      user_id:          this.userId,
      domains:          this.selectedDomains,
      quarter_type:     this.quarterType,
      target_date:      this.targetDate,
      end_date_label:   this.endDateLabel,
      goals:            this.completedDomains,
      scores_at_start:  this.scores,
      horizon_gap_data: this.horizonGapData,
      has_map_data:     this.hasMapData,
      status:           'active',
      completed_at:     new Date().toISOString(),
    };
    try {
      if (this.sessionId) {
        await sb.from('target_goal_sessions')
          .update({ goals: this.completedDomains, updated_at: new Date().toISOString() })
          .eq('id', this.sessionId);
      } else {
        const { data } = await sb.from('target_goal_sessions')
          .insert(sessionData).select('id').single();
        if (data?.id) this.sessionId = data.id;
      }
    } catch (e) {
      console.warn('[TargetGoals] Supabase save failed:', e);
    }
  },

  showToast(msg) {
    const toast = document.getElementById('saveToast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 1800);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;
