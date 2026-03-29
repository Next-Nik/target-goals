// TARGET GOALS — APP LOGIC
// Three phases: Selection → Goal Setting → Complete
// Standalone or linked from The Map via profile data.

const DOMAINS = [
  { id: "path",          label: "Path",          question: "Am I walking my path — or just walking?" },
  { id: "spark",         label: "Spark",         question: "Is the fire on?" },
  { id: "body",          label: "Body",          question: "How is this living system doing?" },
  { id: "finances",      label: "Finances",      question: "Do I have the agency to act on what matters?" },
  { id: "relationships", label: "Relationships", question: "Am I truly known by anyone?" },
  { id: "inner_game",    label: "Inner Game",    question: "Are my stories tending me, or running me?" },
  { id: "outer_game",    label: "Outer Game",    question: "Is what I'm broadcasting aligned with who I actually am?" },
];

// ── STATE ─────────────────────────────────────────────────────────────────────
const App = {
  phase: "setup",        // setup | select | refine | complete
  mapData: null,         // from profile if available
  scores: {},            // domain id → score (0-10)
  hasMapData: false,
  selectedDomains: [],   // up to 3 domain ids
  quarterType: null,     // 'rolling' | 'calendar'
  targetDate: null,
  endDateLabel: null,
  completedDomains: [],  // domains with finished goals
  currentDomainIndex: 0, // which of the three we're refining
  messages: [],          // current chat messages for active domain
  session: null,         // full session object for Supabase
  sessionId: null,
  userId: null,
  isWaiting: false,
  recommendation: null,  // AI recommendation from phase 1

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

      // Load most recent completed Map session
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

  // ── RENDER ───────────────────────────────────────────────────────────────────
  render() {
    const app = document.getElementById('app');
    if (!app) return;

    if (this.phase === "setup")    { app.innerHTML = this.renderSetup(); this.bindSetup(); }
    if (this.phase === "select")   { app.innerHTML = this.renderSelect(); this.bindSelect(); }
    if (this.phase === "quarter")  { app.innerHTML = this.renderQuarter(); this.bindQuarter(); }
    if (this.phase === "refine")   { app.innerHTML = this.renderRefine(); this.bindRefine(); }
    if (this.phase === "complete") { app.innerHTML = this.renderComplete(); this.bindComplete(); }
  },

  // ── PHASE: SETUP (self-rate if no Map data) ───────────────────────────────
  renderSetup() {
    if (this.hasMapData) {
      // Skip setup — go straight to domain selection
      setTimeout(() => { this.phase = "select"; this.render(); }, 0);
      return '<div class="body-text" style="text-align:center;padding:60px 0;">Loading your Map data...</div>';
    }

    const rows = DOMAINS.map(d => {
      const score = this.scores[d.id];
      const buttons = [1,2,3,4,5,6,7,8,9,10].map(n =>
        `<button class="rate-btn ${score === n ? 'selected' : ''}" data-domain="${d.id}" data-score="${n}">${n}</button>`
      ).join('');
      return `
        <div class="self-rate-row">
          <span class="self-rate-label">${d.label}</span>
          <p class="self-rate-question">${d.question}</p>
          <div class="self-rate-buttons">${buttons}</div>
        </div>`;
    }).join('');

    const allRated = DOMAINS.every(d => this.scores[d.id] !== undefined);

    return `
      <span class="eyebrow">Life OS · Target Goals</span>
      <h1>Where are you right now?</h1>
      <div class="rule"></div>
      <p class="body-text">Rate yourself honestly across the seven areas of your life. 1 is nowhere near where you want to be. 10 is exactly where you want to be. No one sees this but you.</p>
      <div class="self-rate-grid">${rows}</div>
      <button class="btn" id="toSelectBtn" ${allRated ? '' : 'disabled'}>
        Choose my focus areas →
      </button>`;
  },

  bindSetup() {
    document.querySelectorAll('.rate-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const domain = btn.dataset.domain;
        const score  = parseInt(btn.dataset.score);
        this.scores[domain] = score;
        // Update UI
        document.querySelectorAll(`[data-domain="${domain}"]`).forEach(b => {
          b.classList.toggle('selected', parseInt(b.dataset.score) === score);
        });
        // Enable button if all rated
        const allRated = DOMAINS.every(d => this.scores[d.id] !== undefined);
        const btn2 = document.getElementById('toSelectBtn');
        if (btn2) btn2.disabled = !allRated;
      });
    });
    document.getElementById('toSelectBtn')?.addEventListener('click', () => {
      this.phase = "select";
      this.render();
      this.getRecommendation();
    });
  },

  // ── PHASE: SELECT DOMAINS ────────────────────────────────────────────────────
  async getRecommendation() {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'recommend',
          scores: this.scores,
          hasMapData: this.hasMapData
        })
      });
      this.recommendation = await res.json();
      this.render();
    } catch (e) {
      console.warn('[TargetGoals] Recommendation failed:', e);
    }
  },

  renderSelect() {
    const rec = this.recommendation;
    const cards = DOMAINS.map((d, i) => {
      const selected  = this.selectedDomains.includes(d.id);
      const isRec     = rec?.recommended?.includes(d.id);
      const rationale = rec?.rationale?.[d.id];
      const score     = this.scores[d.id];
      const disabled  = !selected && this.selectedDomains.length >= 3;

      return `
        <div class="domain-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}"
             data-id="${d.id}" role="button" tabindex="0">
          <div class="domain-name">${d.label}${isRec ? ' ✦' : ''}</div>
          <div class="domain-question">${rationale || d.question}</div>
          ${score !== undefined ? `
            <div class="domain-score-bar">
              <div class="domain-score-fill" style="width:${score * 10}%"></div>
            </div>
            <div class="domain-score-label">${score}/10</div>
          ` : ''}
        </div>`;
    }).join('');

    const obs = rec?.soft_observation;
    const canContinue = this.selectedDomains.length === 3;

    return `
      <span class="eyebrow">Phase 1 · Focus Areas</span>
      <h1>Choose three areas.</h1>
      <div class="rule"></div>
      <p class="body-text">
        ${this.hasMapData
          ? 'These are your seven Life OS domains. The ✦ mark shows what the AI suggests based on your Map. Choose three — you have the final say.'
          : 'Choose the three areas where focused effort over the next quarter would matter most.'}
      </p>
      ${obs ? `<div class="soft-warning">${obs}</div>` : ''}
      <div class="domain-grid">${cards}</div>
      <button class="btn" id="toQuarterBtn" ${canContinue ? '' : 'disabled'}>
        Set my quarter →
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

  // ── PHASE: QUARTER ALIGNMENT ─────────────────────────────────────────────────
  renderQuarter() {
    const today = new Date();
    const rolling = new Date(today);
    rolling.setDate(rolling.getDate() + 90);

    // Next calendar quarter end
    const month = today.getMonth(); // 0-indexed
    let qEnd;
    if (month < 3)       qEnd = new Date(today.getFullYear(), 2, 31);   // Q1: Mar 31
    else if (month < 6)  qEnd = new Date(today.getFullYear(), 5, 30);   // Q2: Jun 30
    else if (month < 9)  qEnd = new Date(today.getFullYear(), 8, 30);   // Q3: Sep 30
    else                 qEnd = new Date(today.getFullYear(), 11, 31);  // Q4: Dec 31

    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const qLabel = month < 3 ? 'Q1' : month < 6 ? 'Q2' : month < 9 ? 'Q3' : 'Q4';
    const rollingDays = 90;
    const calDays = Math.round((qEnd - today) / (1000 * 60 * 60 * 24));

    this._rollingDate = rolling;
    this._calDate = qEnd;
    this._rollingLabel = `${rollingDays} days — ${fmt(rolling)}`;
    this._calLabel = `${qLabel} end — ${fmt(qEnd)} (${calDays} days)`;

    return `
      <span class="eyebrow">Phase 1 · Timeline</span>
      <h2>When does this quarter end?</h2>
      <div class="rule"></div>
      <p class="body-text">Choose a target date. Both work — this is about what rhythm fits your life.</p>
      <div class="quarter-options">
        <div class="quarter-option ${this.quarterType === 'rolling' ? 'selected' : ''}" data-type="rolling">
          <div class="quarter-option-title">Rolling 90 days</div>
          <div class="quarter-option-date">${fmt(rolling)}</div>
          <div class="quarter-option-desc">Starts today. 90 days of focused movement.</div>
        </div>
        <div class="quarter-option ${this.quarterType === 'calendar' ? 'selected' : ''}" data-type="calendar">
          <div class="quarter-option-title">Calendar quarter</div>
          <div class="quarter-option-date">${fmt(qEnd)}</div>
          <div class="quarter-option-desc">${qLabel} end — syncs with how the year flows.</div>
        </div>
      </div>
      <button class="btn" id="toRefineBtn" ${this.quarterType ? '' : 'disabled'}>
        Set my targets →
      </button>`;
  },

  bindQuarter() {
    document.querySelectorAll('.quarter-option').forEach(opt => {
      opt.addEventListener('click', () => {
        this.quarterType = opt.dataset.type;
        if (this.quarterType === 'rolling') {
          this.targetDate = this._rollingDate.toISOString().slice(0, 10);
          this.endDateLabel = this._rollingLabel;
        } else {
          this.targetDate = this._calDate.toISOString().slice(0, 10);
          this.endDateLabel = this._calLabel;
        }
        this.render();
      });
    });
    document.getElementById('toRefineBtn')?.addEventListener('click', () => {
      this.phase = "refine";
      this.currentDomainIndex = 0;
      this.messages = [];
      this.render();
      this.startRefinement();
    });
  },

  // ── PHASE 2: GOAL REFINEMENT ─────────────────────────────────────────────────
  renderRefine() {
    const domain = DOMAINS.find(d => d.id === this.selectedDomains[this.currentDomainIndex]);
    const domainLabel = domain?.label || '';
    const total = this.selectedDomains.length;
    const current = this.currentDomainIndex + 1;

    const msgs = this.messages.map(m => {
      if (m.role === 'assistant') return `<div class="msg-assistant">${m.content.replace(/\n/g, '<br>')}</div>`;
      if (m.role === 'user')      return `<div class="msg-user">${m.content}</div>`;
      if (m.role === 'system')    return `<div class="msg-system">${m.content}</div>`;
      return '';
    }).join('');

    const typing = this.isWaiting
      ? `<div class="typing"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>` : '';

    // Completed domain summaries
    const completedSummaries = this.completedDomains.map(d => {
      const dl = DOMAINS.find(x => x.id === d.domain);
      return `
        <div class="goal-card" style="margin-bottom:14px;">
          <div class="goal-card-domain">${dl?.label || d.domain} ✓</div>
          <div class="goal-card-outcome">${d.outcome_user || d.outcome_system}</div>
          ${d.outcome_user && d.outcome_user !== d.outcome_system
            ? `<div class="edit-toggle" style="font-size:12px;color:var(--meta);margin-top:6px;">AI suggested: "${d.outcome_system}"</div>`
            : ''}
        </div>`;
    }).join('');

    return `
      ${completedSummaries}
      <span class="eyebrow">Area ${current} of ${total} · ${domainLabel}</span>
      <h2>Let's build your ${domainLabel} goal.</h2>
      <div class="rule"></div>
      <div class="chat-area" id="chatArea">${msgs}${typing}</div>
      <div style="height:120px;"></div>
      <div class="input-area">
        <div class="input-inner">
          <textarea class="input-field" id="userInput"
            placeholder="Type your response..."
            rows="1"
            ${this.isWaiting ? 'disabled' : ''}
          ></textarea>
          <button class="send-btn" id="sendBtn" ${this.isWaiting ? 'disabled' : ''}>Send</button>
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
    const domainId = this.selectedDomains[this.currentDomainIndex];
    const score    = this.scores[domainId];
    const domainData = this.mapData?.domainData?.[domainId];

    this.messages = [];
    this.isWaiting = true;
    this.render();

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'refine',
        domain: domainId,
        domainScore: domainData?.placement || null,
        currentScore: score,
        targetDate: this.endDateLabel,
        messages: [{ role: 'user', content: 'BEGIN' }],
        completedDomains: this.completedDomains
      })
    });

    const data = await res.json();
    this.isWaiting = false;

    if (data.message) {
      this.messages = [{ role: 'assistant', content: data.message }];
    }

    this.render();
    this.scrollChat();
  },

  async sendMessage(text) {
    this.messages.push({ role: 'user', content: text });
    this.isWaiting = true;
    this.render();
    this.scrollChat();

    const domainId = this.selectedDomains[this.currentDomainIndex];
    const score    = this.scores[domainId];
    const domainData = this.mapData?.domainData?.[domainId];

    // Build API messages (exclude system markers)
    const apiMessages = this.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'refine',
        domain: domainId,
        domainScore: domainData?.placement || null,
        currentScore: score,
        targetDate: this.endDateLabel,
        messages: apiMessages,
        completedDomains: this.completedDomains
      })
    });

    const data = await res.json();
    this.isWaiting = false;

    if (data.complete && data.data) {
      // Goal is solid — save and move on
      this.saveGoal(domainId, data.data);
    } else if (data.message) {
      this.messages.push({ role: 'assistant', content: data.message });
      this.render();
      this.scrollChat();
    }
  },

  saveGoal(domainId, goalData) {
    // Store the system version — user can override later
    const goal = {
      domain:            domainId,
      outcome_system:    goalData.outcome_system,
      outcome_user:      null,   // null until user explicitly edits
      month3:            goalData.month3,
      month2:            goalData.month2,
      month1:            goalData.month1,
      weeks:             goalData.weeks,
      tea:               goalData.tea,
      conversation_insight: goalData.conversation_insight,
    };

    this.completedDomains.push(goal);

    // Move to next domain or complete
    if (this.currentDomainIndex < this.selectedDomains.length - 1) {
      this.currentDomainIndex++;
      this.messages = [{ role: 'system', content: `${DOMAINS.find(d => d.id === domainId)?.label} goal set. Moving to the next area.` }];
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

  // ── PHASE: COMPLETE ───────────────────────────────────────────────────────────
  renderComplete() {
    const goals = this.completedDomains.map(d => {
      const dl = DOMAINS.find(x => x.id === d.domain);
      const outcome = d.outcome_user || d.outcome_system;

      const milestones = `
        <div class="goal-card-milestones">
          <div class="milestone"><span class="milestone-label">Month 3</span><span class="milestone-text">${d.month3}</span></div>
          <div class="milestone"><span class="milestone-label">Month 2</span><span class="milestone-text">${d.month2}</span></div>
          <div class="milestone"><span class="milestone-label">Month 1</span><span class="milestone-text">${d.month1}</span></div>
        </div>`;

      const tea = d.tea ? `
        <div class="tea-section">
          <span class="tea-label">Daily T.E.A.</span>
          <div class="tea-anchor"><span class="tea-type">Thoughts</span><span class="tea-text">${d.tea.thoughts}</span></div>
          <div class="tea-anchor"><span class="tea-type">Emotions</span><span class="tea-text">${d.tea.emotions}</span></div>
          <div class="tea-anchor"><span class="tea-type">Actions</span><span class="tea-text">${d.tea.actions}</span></div>
        </div>` : '';

      // User override section
      const editSection = `
        <div style="margin-top:16px;">
          <button class="edit-toggle" data-domain="${d.domain}">
            ${d.outcome_user ? 'Your version saved ✓ — edit again' : 'Edit this goal →'}
          </button>
          <div class="edit-overlay" id="edit-${d.domain}">
            <textarea class="edit-textarea" placeholder="Write your own version of this goal..."
              data-domain="${d.domain}">${d.outcome_user || d.outcome_system}</textarea>
            <p class="edit-hint">Your version leads. The AI's version stays accessible behind this.</p>
            ${d.outcome_system !== d.outcome_user && d.outcome_user
              ? `<p class="edit-hint" style="margin-top:6px;">AI suggested: "${d.outcome_system}"</p>` : ''}
            <button class="btn" style="margin-top:12px;padding:10px 24px;font-size:13px;"
              data-save-domain="${d.domain}">Save my version →</button>
          </div>
        </div>`;

      return `
        <div class="goal-card">
          <div class="goal-card-domain">${dl?.label}</div>
          <div class="goal-card-outcome">${outcome}</div>
          ${milestones}
          ${tea}
          ${editSection}
        </div>`;
    }).join('');

    return `
      <div class="completion-header">
        <span class="completion-glyph">✦</span>
        <span class="eyebrow">Quarter set</span>
        <h1>${this.endDateLabel || '90 days ahead'}</h1>
        <p class="body-text" style="max-width:480px;margin:0 auto;">
          The goal is not the point — what you become moving toward it is.
          Three areas. One quarter. Let's see what moves.
        </p>
      </div>
      ${goals}
      <div style="text-align:center;margin-top:40px;">
        <a href="https://nextus.world/profile.html" class="btn">Go to your profile →</a>
      </div>`;
  },

  bindComplete() {
    // Edit toggles
    document.querySelectorAll('.edit-toggle[data-domain]').forEach(btn => {
      btn.addEventListener('click', () => {
        const overlay = document.getElementById(`edit-${btn.dataset.domain}`);
        overlay?.classList.toggle('open');
      });
    });

    // Save user versions
    document.querySelectorAll('[data-save-domain]').forEach(btn => {
      btn.addEventListener('click', () => {
        const domainId  = btn.dataset.saveDomain;
        const textarea  = document.querySelector(`.edit-textarea[data-domain="${domainId}"]`);
        const value     = textarea?.value?.trim();
        if (!value) return;

        const goal = this.completedDomains.find(d => d.domain === domainId);
        if (goal) {
          goal.outcome_user = value;
          this.saveToSupabase();
          this.showToast('Saved');
        }

        const overlay = document.getElementById(`edit-${domainId}`);
        overlay?.classList.remove('open');
        this.render();
        this.bindComplete();
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
