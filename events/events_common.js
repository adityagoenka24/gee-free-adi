const Events = (() => {
  const $ = (id) => document.getElementById(id);
  const state = { config: null, current: 0, answers: [], qTimes: [], qStartedAt: 0, startedAt: null, submitted: false, timer: null, remaining: 0 };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  function slug(value) {
    return String(value || "event").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "event";
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function downloadText(filename, text, type = "text/plain") {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function shuffle(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function answerLetter(value) {
    const text = String(value ?? "").trim();
    const match = text.match(/^[A-E]/i);
    return match ? match[0].toUpperCase() : text.toUpperCase();
  }

  function normalizeAnswer(value) {
    if (Array.isArray(value)) return value.map(answerLetter).sort().join(",");
    return String(value ?? "").trim().replace(/\s+/g, " ");
  }

  function isNumericEqual(a, b) {
    const na = Number(String(a).trim());
    const nb = Number(String(b).trim());
    return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 1e-9;
  }

  function isCorrect(question, studentAnswer) {
    if (studentAnswer === undefined || studentAnswer === null || studentAnswer === "" || (Array.isArray(studentAnswer) && !studentAnswer.length)) return false;
    if (question.type === "numeric_entry") return isNumericEqual(studentAnswer, question.answer) || normalizeAnswer(studentAnswer).toLowerCase() === normalizeAnswer(question.answer).toLowerCase();
    if (question.type === "multiple_answer") return normalizeAnswer(studentAnswer) === normalizeAnswer(question.answer);
    return answerLetter(studentAnswer) === answerLetter(question.answer);
  }

  function typeLabel(type) {
    return {
      mcq: "MCQ",
      numeric_entry: "Numeric Entry",
      quantitative_comparison: "Quant Comp.",
      multiple_answer: "Multi-Answer"
    }[type] || String(type || "Question");
  }

  function difficultyLabel(diff) {
    return String(diff || "unspecified").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function loadJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${path}`);
    return response.json();
  }

  async function loadConfig(defaultPath = "config/mock_001.json") {
    const params = new URLSearchParams(location.search);
    const configPath = params.get("config") || defaultPath;
    const config = await loadJson(configPath);
    if (config.shuffle_questions_for_students) config.questions = shuffle(config.questions || []);
    return config;
  }

  function enrichQuestion(question, topic, subtopic) {
    return {
      ...question,
      topic: question.topic || topic || "Mixed",
      subtopic: question.subtopic || subtopic || "Mixed"
    };
  }

  function summarize(results) {
    const total = results.length;
    const correct = results.filter((r) => r.correct).length;
    const skipped = results.filter((r) => r.skipped).length;
    const incorrect = total - correct - skipped;
    const totalTime = results.reduce((sum, r) => sum + (Number(r.time_taken_seconds) || 0), 0);
    return {
      score: correct,
      total_questions: total,
      accuracy: total ? Number(((correct / total) * 100).toFixed(2)) : 0,
      correct,
      incorrect,
      skipped,
      total_time_seconds: totalTime,
      average_time_seconds: total ? Number((totalTime / total).toFixed(1)) : 0
    };
  }

  function breakdown(results, key) {
    const map = new Map();
    for (const r of results) {
      const k = r[key] || "Unspecified";
      if (!map.has(k)) map.set(k, { label: k, total: 0, correct: 0, skipped: 0, time: 0 });
      const item = map.get(k);
      item.total += 1;
      item.correct += r.correct ? 1 : 0;
      item.skipped += r.skipped ? 1 : 0;
      item.time += Number(r.time_taken_seconds) || 0;
    }
    return [...map.values()].map((item) => ({
      ...item,
      accuracy: item.total ? Number(((item.correct / item.total) * 100).toFixed(2)) : 0,
      avg_time_seconds: item.total ? Number((item.time / item.total).toFixed(1)) : 0
    }));
  }

  function buildResult(student, team) {
    const submittedAt = new Date();
    const results = state.config.questions.map((q, i) => {
      const answer = state.answers[i];
      const skipped = answer === undefined || answer === null || answer === "" || (Array.isArray(answer) && !answer.length);
      return {
        question_id: q.id,
        question_text: q.question || "",
        student_answer: skipped ? null : answer,
        correct_answer: q.answer,
        correct: isCorrect(q, answer),
        skipped,
        time_taken_seconds: Math.max(0, Math.round(state.qTimes[i] || 0)),
        estimated_time_seconds: q.estimated_time_seconds || 90,
        difficulty: q.difficulty || "unspecified",
        type: q.type || "unspecified",
        topic: q.topic || "Mixed",
        subtopic: q.subtopic || "Mixed",
        tags: q.tags || [],
        explanation: q.explanation || "",
        trap: q.trap || ""
      };
    });
    const summary = summarize(results);
    return {
      event_id: state.config.event_id,
      event_name: state.config.event_name,
      event_type: state.config.event_type,
      student,
      team: team || null,
      started_at: state.startedAt.toISOString(),
      submitted_at: submittedAt.toISOString(),
      total_time_seconds: Math.max(0, Math.round((submittedAt - state.startedAt) / 1000)),
      score: summary.score,
      total_questions: summary.total_questions,
      accuracy: summary.accuracy,
      correct: summary.correct,
      incorrect: summary.incorrect,
      skipped: summary.skipped,
      average_time_seconds: summary.average_time_seconds,
      breakdowns: {
        topic: breakdown(results, "topic"),
        subtopic: breakdown(results, "subtopic"),
        difficulty: breakdown(results, "difficulty"),
        type: breakdown(results, "type")
      },
      results
    };
  }

  function setQuestionTime(index) {
    if (!state.qStartedAt || state.submitted) return;
    const now = Date.now();
    state.qTimes[index] = (state.qTimes[index] || 0) + (now - state.qStartedAt) / 1000;
    state.qStartedAt = now;
  }

  function renderQuestion() {
    const q = state.config.questions[state.current];
    const diff = q.difficulty || "medium";
    const isLast = state.current === state.config.questions.length - 1;
    $("eventQuestionArea").innerHTML = `
      <div class="practice-q-card">
        <div class="pq-header">
          <div class="pq-left">
            <span class="q-number">Q${state.current + 1}</span>
            // <span class="pq-badge ${escapeHtml(diff)}">${escapeHtml(difficultyLabel(diff))}</span>
            <span class="pq-type-badge">${escapeHtml(typeLabel(q.type))}</span>
          </div>
          <span style="font-size:12px;color:var(--text3);font-family:var(--font-mono);">~${q.estimated_time_seconds || 90}s suggested</span>
        </div>
        <div class="pq-body">${renderAnswerControl(q, state.answers[state.current])}</div>
        <div class="pq-footer">
          <button class="btn btn-ghost btn-sm" id="prevBtn" onclick="Events.prevQuestion()" ${state.current === 0 || state.config.allow_navigation === false ? "disabled" : ""}>Prev</button>
          <span style="font-size:12px;color:var(--text3);font-family:var(--font-mono);" id="examQuestionStatus"></span>
          <button class="btn btn-primary btn-sm" id="nextBtn" onclick="Events.nextQuestion()">${isLast ? "Last Question" : "Next"}</button>
        </div>
      </div>`;
    renderNav();
  }

  function renderAnswerControl(q, currentAnswer) {
    if (q.type === "numeric_entry") {
      return `<p class="pq-question-text">${escapeHtml(q.question)}</p>
        <div class="pq-numeric-wrap">
          <input id="numericAnswer" type="text" value="${escapeHtml(currentAnswer || "")}" placeholder="Enter answer" oninput="Events.setAnswer(this.value)" onkeydown="if(event.key==='Enter')Events.nextQuestion()">
          <div style="font-size:12px;color:var(--text3);margin-top:8px;font-family:var(--font-mono);">Type your answer · Enter to go next</div>
        </div>`;
    }
    if (q.type === "quantitative_comparison") {
      const lines = String(q.question || "").split("\n");
      const intro = lines[0] || "";
      const colA = (lines.find((line) => line.startsWith("Column A:")) || "Column A: -").replace("Column A:", "").trim();
      const colB = (lines.find((line) => line.startsWith("Column B:")) || "Column B: -").replace("Column B:", "").trim();
      const selected = new Set(currentAnswer ? [Array.isArray(currentAnswer) ? currentAnswer[0] : currentAnswer] : []);
      return `<p class="pq-question-text">${escapeHtml(intro)}</p>
        <div class="pq-qc-grid">
          <div class="pq-qc-col"><div class="pq-qc-label">Column A</div><div class="pq-qc-content">${escapeHtml(colA)}</div></div>
          <div class="pq-qc-col"><div class="pq-qc-label">Column B</div><div class="pq-qc-content">${escapeHtml(colB)}</div></div>
        </div>
        <div class="pq-qc-options">${(q.options || []).map((option) => {
          const letter = answerLetter(option);
          return `<button class="pq-option ${selected.has(letter) ? "selected" : ""}" onclick="Events.chooseOption('${letter}', false)">${escapeHtml(option)}</button>`;
        }).join("")}</div>`;
    }
    const multiple = q.type === "multiple_answer";
    const selected = new Set(Array.isArray(currentAnswer) ? currentAnswer : currentAnswer ? [currentAnswer] : []);
    return `<p class="pq-question-text">${escapeHtml(q.question)}</p>
      ${multiple ? '<p style="font-size:12px;color:var(--warning);font-family:var(--font-mono);margin-bottom:12px;">Select all that apply</p>' : ""}
      <div class="pq-options">${(q.options || []).map((option) => {
      const letter = answerLetter(option);
      const isSelected = selected.has(letter);
      return `<button class="pq-option ${isSelected ? "selected" : ""}" onclick="Events.chooseOption('${letter}', ${multiple})">
        <span class="pq-opt-letter">${letter}</span>${escapeHtml(String(option).replace(/^[A-E]\.\s*/, ""))}</button>`;
    }).join("")}</div>`;
  }

  function renderNav() {
    const answeredCount = state.answers.filter((a) => a && (!Array.isArray(a) || a.length)).length;
    const unanswered = state.answers.length - answeredCount;
    $("progressText").textContent = `Q ${state.current + 1} / ${state.config.questions.length}${state.answers[state.current] && (!Array.isArray(state.answers[state.current]) || state.answers[state.current].length) ? " ✓" : ""}`;
    $("numberNav").innerHTML = state.config.questions.map((_, i) => {
      const canJump = state.config.allow_navigation !== false;
      const click = canJump ? `onclick="Events.goQuestion(${i})"` : "";
      return `<button class="exam-dot ${i === state.current ? "current" : ""} ${state.answers[i] && (!Array.isArray(state.answers[i]) || state.answers[i].length) ? "answered" : ""}" ${click} ${canJump ? "" : "disabled"}>${i + 1}</button>`;
    }).join("");
    if ($("unansweredWarning")) {
      $("unansweredWarning").textContent = unanswered > 0 ? `${unanswered} unanswered` : "All answered";
      $("unansweredWarning").style.color = unanswered > 0 ? "var(--warning)" : "var(--success)";
    }
    if ($("examQuestionStatus")) {
      const answer = state.answers[state.current];
      $("examQuestionStatus").textContent = answer && (!Array.isArray(answer) || answer.length)
        ? `Answered: ${Array.isArray(answer) ? answer.join(", ") : answer}`
        : "Not answered";
    }
  }

  function chooseOption(letter, multiple) {
    if (multiple) {
      const current = new Set(Array.isArray(state.answers[state.current]) ? state.answers[state.current] : []);
      current.has(letter) ? current.delete(letter) : current.add(letter);
      state.answers[state.current] = [...current].sort();
    } else {
      state.answers[state.current] = letter;
    }
    renderQuestion();
  }

  function setAnswer(value) {
    state.answers[state.current] = value;
    renderNav();
  }

  function goQuestion(index) {
    if (index < 0 || index >= state.config.questions.length) return;
    if (state.config.allow_navigation === false && index !== state.current + 1) return;
    setQuestionTime(state.current);
    state.current = index;
    renderQuestion();
  }

  function nextQuestion() {
    if (state.current < state.config.questions.length - 1) goQuestion(state.current + 1);
    else $("numberNav").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function prevQuestion() {
    if (state.config.allow_navigation === false) return;
    if (state.current > 0) goQuestion(state.current - 1);
  }

  function startTimer() {
    state.remaining = Number(state.config.timer_seconds) || 0;
    const tick = () => {
      $("timer").textContent = state.config.timer_seconds ? formatTime(state.remaining) : "Untimed";
      $("timer").classList.toggle("critical", state.remaining > 0 && state.remaining <= 120);
      if (state.config.timer_seconds && state.remaining <= 0) {
        submitEvent(true);
        return;
      }
      if (state.remaining > 0) state.remaining -= 1;
    };
    tick();
    if (state.remaining) state.timer = setInterval(tick, 1000);
  }

  function kpiCard(icon, value, label, color) {
    return `<div class="kpi-card" style="border-top:3px solid ${color};">
      <div class="kpi-icon">${icon}</div>
      <div class="kpi-value" style="color:${color};font-family:var(--font-display);font-size:28px;">${value}</div>
      <div class="kpi-label">${escapeHtml(label)}</div>
    </div>`;
  }

  function barRow(label, correct, total, pct, color) {
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
      <span style="width:100px;font-size:13px;color:var(--text2);flex-shrink:0;">${escapeHtml(label)}</span>
      <div style="flex:1;height:6px;background:var(--surface3);border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;transition:width 0.8s ease;"></div>
      </div>
      <span style="font-family:var(--font-mono);font-size:12px;color:${color};min-width:70px;text-align:right;">${correct}/${total} (${pct}%)</span>
    </div>`;
  }

  function renderAnalysisBars(result) {
    const dOrder = ["easy", "medium", "hard", "extreme_hard"];
    const dLabels = { easy: "Easy", medium: "Medium", hard: "Hard", extreme_hard: "Extreme" };
    const byDiff = {};
    result.results.forEach((r) => {
      const d = r.difficulty;
      if (!byDiff[d]) byDiff[d] = { total: 0, correct: 0 };
      byDiff[d].total += 1;
      if (r.correct) byDiff[d].correct += 1;
    });
    $("exam-diff-bars").innerHTML = dOrder.filter((d) => byDiff[d]).map((d) => {
      const s = byDiff[d];
      const pct = Math.round((s.correct / s.total) * 100);
      const col = pct >= 75 ? "var(--success)" : pct >= 50 ? "var(--warning)" : "var(--danger)";
      return barRow(dLabels[d], s.correct, s.total, pct, col);
    }).join("") || '<p style="color:var(--text3);font-size:13px;">No data</p>';

    const byType = {};
    result.results.forEach((r) => {
      const t = r.type;
      if (!byType[t]) byType[t] = { total: 0, correct: 0 };
      byType[t].total += 1;
      if (r.correct) byType[t].correct += 1;
    });
    $("exam-type-bars").innerHTML = Object.entries(byType).map(([t, s]) => {
      const pct = Math.round((s.correct / s.total) * 100);
      const col = pct >= 75 ? "var(--success)" : pct >= 50 ? "var(--warning)" : "var(--danger)";
      return barRow(typeLabel(t), s.correct, s.total, pct, col);
    }).join("") || '<p style="color:var(--text3);font-size:13px;">No data</p>';
  }

  function renderTimeTable(result) {
    const dLabels = { easy: "Easy", medium: "Medium", hard: "Hard", extreme_hard: "Extreme" };
    $("exam-time-table").innerHTML = `
      <table><thead><tr>
        <th>#</th><th>Difficulty</th><th>Type</th><th>Est. Time</th><th>Actual Time</th><th>Result</th>
      </tr></thead><tbody>
      ${result.results.map((r, i) => {
        const icon = r.correct ? "✅" : r.skipped ? "⏭" : "❌";
        return `<tr>
          <td style="font-family:var(--font-mono);">Q${i + 1}</td>
          <td><span class="tag tag-${escapeHtml(String(r.difficulty).replace("_", "-"))}">${escapeHtml(dLabels[r.difficulty] || difficultyLabel(r.difficulty))}</span></td>
          <td style="font-size:12px;color:var(--text2);">${escapeHtml(typeLabel(r.type))}</td>
          <td style="font-family:var(--font-mono);font-size:12px;color:var(--text3);">${formatTime(r.estimated_time_seconds || 90)}</td>
          <td style="font-family:var(--font-mono);font-size:12px;color:var(--text3);">${formatTime(r.time_taken_seconds || 0)}</td>
          <td>${icon}</td>
        </tr>`;
      }).join("")}
      </tbody></table>`;
  }

  function renderWrongReview(result) {
    const wrong = (result.results || []).filter((r) => !r.correct);
    if (!wrong.length) {
      return `<div class="table-card" style="margin-bottom:24px;text-align:center;padding:40px;">
        <div style="font-size:48px;margin-bottom:16px;">🏆</div>
        <div style="font-family:var(--font-display);font-size:22px;margin-bottom:8px;">Perfect Score!</div>
        <div style="color:var(--text2);font-size:14px;">All questions answered correctly.</div>
      </div>`;
    }
    return `<div class="table-card" style="margin-bottom:24px;">
      <h3>Questions to Review (${wrong.length})</h3>
      <div class="wrong-q-list">${wrong.map((r) => {
        const correctAnswer = Array.isArray(r.correct_answer) ? r.correct_answer.join(", ") : r.correct_answer;
        const studentAnswer = r.skipped ? "(no answer)" : Array.isArray(r.student_answer) ? r.student_answer.join(", ") : r.student_answer;
        return `<div class="wrong-q-card">
          <div class="wrong-q-header">
            <span class="pq-badge ${escapeHtml(r.difficulty)}">${escapeHtml(difficultyLabel(r.difficulty))}</span>
            <span class="pq-type-badge">${escapeHtml(typeLabel(r.type))}</span>
            <span style="font-size:12px;color:var(--text3);font-family:var(--font-mono);">${escapeHtml(r.question_id)}</span>
            ${r.skipped ? '<span style="font-size:12px;color:var(--text3);font-family:var(--font-mono);">Skipped</span>' : ""}
          </div>
          <div class="wrong-q-body">
            <div class="wrong-q-text">${escapeHtml(r.question_text)}</div>
            <div class="wrong-q-answers">
              <span class="wrong-q-your">Your answer: ${escapeHtml(studentAnswer)}</span>
              <span style="color:var(--text3);">·</span>
              <span class="wrong-q-correct">Correct: ${escapeHtml(correctAnswer)}</span>
            </div>
            ${r.explanation ? `<div class="wrong-q-explanation">${escapeHtml(r.explanation)}</div>` : ""}
            ${r.trap ? `<div class="wrong-q-trap">⚠️ Trap: ${escapeHtml(r.trap)}</div>` : ""}
          </div>
        </div>`;
      }).join("")}</div>
    </div>`;
  }

  function renderProCta(result) {
    const weak = [...(result.breakdowns.subtopic || [])].sort((a, b) => a.accuracy - b.accuracy)[0];
    const weakText = weak ? `Your weakest area in this event was ${escapeHtml(weak.label)} at ${weak.accuracy}%.` : "This event is only the starting diagnostic.";
    return `<div class="pro-analysis-cta">
      <div>
        <h3>Turn this analysis into your next score jump.</h3>
        <p>${weakText} GRE Quant Pro gives you this same analysis after every session, plus access to the full 8,410+ question bank across 88 subtopics.</p>
        <div class="pro-cta-points">
          <span>8,410+ practice questions</span>
          <span>Trap explanations</span>
          <span>Timed exam mode</span>
          <span>Progress analytics</span>
        </div>
      </div>
      <a class="primary-btn" href="../index.html">Upgrade to Pro Today</a>
    </div>`;
  }

  function renderResults(result, timedOut) {
    $("examSection").classList.add("hidden");
    $("resultsSection").classList.remove("hidden");
    $("resultsTitle").textContent = timedOut ? "Time is up. Exam analysis saved." : "Exam Analysis";
    if ($("analysisMeta")) {
      $("analysisMeta").innerHTML = `
        <div class="analysis-meta-item"><span class="al">Student</span><span class="av">${escapeHtml(result.student.name)}</span></div>
        <div class="analysis-meta-item"><span class="al">Event</span><span class="av">${escapeHtml(result.event_name)}</span></div>
        <div class="analysis-meta-item"><span class="al">Date</span><span class="av">${new Date(result.submitted_at).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</span></div>
        <div class="analysis-meta-item"><span class="al">Duration</span><span class="av">${formatTime(result.total_time_seconds)} / ${formatTime(state.config.timer_seconds)} allotted</span></div>`;
    }
    $("exam-kpi-row").innerHTML = [
      kpiCard("🎯", `${result.accuracy}%`, "Accuracy", "var(--accent)"),
      kpiCard("✅", result.correct, "Correct", "var(--success)"),
      kpiCard("❌", result.incorrect, "Incorrect", "var(--danger)"),
      kpiCard("⏭", result.skipped, "Skipped", "var(--text3)"),
      kpiCard("⏱", formatTime(result.total_time_seconds), "Total Time", "var(--warning)"),
      kpiCard("⚡", `${formatTime(result.average_time_seconds)}/q`, "Avg per Q", "var(--accent2)")
    ].join("");
    renderAnalysisBars(result);
    renderTimeTable(result);
    if ($("proCta")) $("proCta").innerHTML = renderProCta(result);
    $("exam-wrong-section").innerHTML = renderWrongReview(result);
    $("downloadResultBtn").onclick = () => downloadJson(`${slug(result.event_id)}_${slug(result.student.name)}_result.json`, result);
    $("emailResultBtn").onclick = () => {
      const subject = encodeURIComponent(`GRE Quant Pro Event Result - ${result.event_name} - ${result.student.name}`);
      const body = encodeURIComponent(`Hi Coach Aditya,\n\nAttached/pasted below is my event result JSON.\n\n${JSON.stringify(result, null, 2)}`);
      location.href = `mailto:goenka.aditya.kol@gmail.com?subject=${subject}&body=${body}`;
    };
  }

  function submitEvent(timedOut = false) {
    if (state.submitted) return;
    setQuestionTime(state.current);
    state.submitted = true;
    clearInterval(state.timer);
    const student = {
      name: $("studentName").value.trim(),
      email: $("studentEmail").value.trim(),
      batch: $("studentBatch").value.trim()
    };
    const team = $("studentTeam") ? $("studentTeam").value : null;
    const result = buildResult(student, team);
    renderResults(result, timedOut);
  }

  async function initStudentPage({ teamMode = false } = {}) {
    try {
      state.config = await loadConfig();
      state.config.questions = (state.config.questions || []).map((q) => enrichQuestion(q, q.topic, q.subtopic));
      if (teamMode) state.config.event_type = "team_battle";
      $("eventName").textContent = state.config.event_name || "GRE Quant Pro Event";
      $("eventDetails").textContent = `${state.config.question_count || state.config.questions.length} questions · ${state.config.timer_seconds ? formatTime(state.config.timer_seconds) : "Untimed"} · ${state.config.allow_navigation === false ? "Locked order" : "Navigation allowed"}`;
      $("instructions").textContent = state.config.instructions || "Answer all questions. Feedback is shown only after submission.";
      $("startBtn").onclick = () => {
        if (!$("studentName").value.trim() || !$("studentEmail").value.trim()) {
          $("startError").textContent = "Name and email are required before starting.";
          return;
        }
        if (teamMode && !$("studentTeam").value) {
          $("startError").textContent = "Choose Red or Blue before starting.";
          return;
        }
        $("startSection").classList.add("hidden");
        $("examSection").classList.remove("hidden");
        if ($("eventMetaName")) $("eventMetaName").textContent = $("studentName").value.trim();
        if ($("eventMetaTopic")) $("eventMetaTopic").textContent = teamMode && $("studentTeam") ? `${state.config.event_name} · ${$("studentTeam").value}` : state.config.event_name;
        state.startedAt = new Date();
        state.answers = new Array(state.config.questions.length).fill(null);
        state.qTimes = new Array(state.config.questions.length).fill(0);
        state.qStartedAt = Date.now();
        renderQuestion();
        startTimer();
      };
      $("submitBtn").onclick = () => submitEvent(false);
    } catch (error) {
      $("startSection").innerHTML = `<div class="notice danger">Could not load event config. ${escapeHtml(error.message)}</div>`;
    }
  }

  return {
    $, state, escapeHtml, slug, formatTime, downloadJson, downloadText, shuffle, loadJson, enrichQuestion, isCorrect, summarize, breakdown,
    chooseOption, setAnswer, goQuestion, nextQuestion, prevQuestion, submitEvent, initStudentPage
  };
})();
