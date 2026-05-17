const Events = (() => {
  const SUBMISSION_ENDPOINT = "https://gre-auth.goenka-aditya-kol.workers.dev/mock/submission";
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

  async function loadConfig(defaultPath = "config/current.json", useQueryParam = true) {
    const params = new URLSearchParams(location.search);
    const configPath = useQueryParam ? params.get("config") || defaultPath : defaultPath;
    const config = await loadJson(configPath);
    if ((config.active_config || config.config_path) && !Array.isArray(config.questions)) {
      const target = String(config.active_config || config.config_path).trim();
      const resolvedPath = target.includes("/") ? target : `config/${target}`;
      return loadConfig(resolvedPath, false);
    }
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

  function weakestBreakdown(items, minTotal = 1) {
    return [...(items || [])]
      .filter((item) => item.total >= minTotal)
      .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total || b.avg_time_seconds - a.avg_time_seconds)[0] || null;
  }

  function strongestBreakdown(items, minTotal = 1) {
    return [...(items || [])]
      .filter((item) => item.total >= minTotal)
      .sort((a, b) => b.accuracy - a.accuracy || b.total - a.total)[0] || null;
  }

  function performanceBand(accuracy) {
    if (accuracy >= 85) return { label: "Strong", tone: "strong", summary: "Your accuracy is already in a good zone. The next gain is speed and consistency." };
    if (accuracy >= 70) return { label: "Close", tone: "close", summary: "You are close. A few recurring errors are costing more than a lack of ability." };
    if (accuracy >= 50) return { label: "Needs Focus", tone: "focus", summary: "You have enough base to build from, but the weak areas need targeted practice." };
    return { label: "High Risk", tone: "risk", summary: "This score pattern needs structured recovery before the next full GRE-style attempt." };
  }

  function getPrimaryWeakArea(result) {
    const minTotal = result.total_questions >= 8 ? 2 : 1;
    const subtopic = weakestBreakdown(result.breakdowns.subtopic, minTotal);
    const topic = weakestBreakdown(result.breakdowns.topic, minTotal);
    const type = weakestBreakdown(result.breakdowns.type, minTotal);
    const difficulty = weakestBreakdown(result.breakdowns.difficulty, minTotal);
    return subtopic || topic || type || difficulty || null;
  }

  function getTimingDiagnosis(result) {
    const attempted = (result.results || []).filter((r) => !r.skipped);
    const slow = attempted.filter((r) => {
      const expected = Number(r.estimated_time_seconds) || 90;
      return (Number(r.time_taken_seconds) || 0) > expected * 1.2;
    });
    const fastWrong = attempted.filter((r) => {
      const expected = Number(r.estimated_time_seconds) || 90;
      return !r.correct && (Number(r.time_taken_seconds) || 0) < expected * 0.55;
    });
    if (slow.length >= Math.max(2, Math.ceil(attempted.length * 0.25))) {
      return {
        label: "Time pressure",
        detail: `${slow.length} question${slow.length === 1 ? "" : "s"} took much longer than the suggested pace. Accuracy may drop when the clock gets tight.`,
        recommendation: "Do one untimed concept round, then repeat the same area at 1:45 per question."
      };
    }
    if (fastWrong.length >= Math.max(2, Math.ceil(attempted.length * 0.2))) {
      return {
        label: "Rushed mistakes",
        detail: `${fastWrong.length} wrong answer${fastWrong.length === 1 ? "" : "s"} came very quickly. That usually means the trap was accepted before the question was fully parsed.`,
        recommendation: "Pause for 5 seconds on hard questions and name what the question is really asking before calculating."
      };
    }
    return {
      label: "Pace is usable",
      detail: `Average pace was ${formatTime(result.average_time_seconds)} per question. The bigger opportunity is accuracy inside weak areas.`,
      recommendation: "Keep the timer on, but make the next practice set topic-specific."
    };
  }

  function getTrapDiagnosis(result) {
    const wrong = (result.results || []).filter((r) => !r.correct);
    const tagged = new Map();
    wrong.forEach((r) => (r.tags || []).forEach((tag) => {
      const label = String(tag || "").replace(/[-_]+/g, " ").trim();
      if (!label) return;
      tagged.set(label, (tagged.get(label) || 0) + 1);
    }));
    const repeatedTag = [...tagged.entries()].sort((a, b) => b[1] - a[1])[0];
    const sampleTrap = wrong.find((r) => r.trap)?.trap || "";
    if (repeatedTag && repeatedTag[1] >= 2) {
      return {
        label: repeatedTag[0].replace(/\b\w/g, (c) => c.toUpperCase()),
        detail: `This trap pattern appeared ${repeatedTag[1]} times in your misses.`,
        sample: sampleTrap
      };
    }
    if (sampleTrap) {
      return {
        label: "Question-specific trap",
        detail: "Your misses were not random. At least one had a clear GRE-style trap pattern.",
        sample: sampleTrap
      };
    }
    if (!wrong.length) {
      return {
        label: "No major trap exposed",
        detail: "No wrong-answer trap was exposed in this attempt.",
        sample: "Now the goal is to prove the same accuracy across harder and mixed sets."
      };
    }
    return {
      label: "Review needed",
      detail: "The missed questions need a second pass to separate concept gaps from careless errors.",
      sample: "Redo each missed question without looking at the solution, then compare your reasoning."
    };
  }

  function buildDiagnosis(result) {
    const band = performanceBand(result.accuracy);
    const weakArea = getPrimaryWeakArea(result);
    const strongest = strongestBreakdown(result.breakdowns.subtopic) || strongestBreakdown(result.breakdowns.topic);
    const timing = getTimingDiagnosis(result);
    const trap = getTrapDiagnosis(result);
    const weakLabel = weakArea ? weakArea.label : "Mixed Quant";
    const weakDetail = weakArea
      ? `${weakArea.correct}/${weakArea.total} correct (${weakArea.accuracy}%) with ${formatTime(weakArea.avg_time_seconds)} average time.`
      : "This mock was too small to isolate one weak zone reliably.";
    const mainIssue = result.skipped >= Math.max(2, Math.ceil(result.total_questions * 0.2))
      ? "Unanswered questions are pulling the score down."
      : result.accuracy < 70
        ? `${weakLabel} needs the next focused practice block.`
        : `${weakLabel} is the best place to chase the next few points.`;
    const recoveryPlan = [
      `Redo the missed ${weakLabel} questions once without the solution open.`,
      `Practice 15-20 ${weakLabel} questions in Pro, starting untimed if accuracy is below 70%.`,
      `Finish with a timed set at GRE pace and check whether the same trap appears again.`
    ];
    return {
      band,
      main_issue: mainIssue,
      weak_area: weakArea ? { label: weakLabel, detail: weakDetail } : { label: weakLabel, detail: weakDetail },
      strongest_area: strongest ? `${strongest.label} (${strongest.accuracy}%)` : "Not enough data yet",
      timing,
      trap,
      recovery_plan: recoveryPlan,
      pro_recommendation: `Start your next Pro session with ${weakLabel}.`
    };
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
    const result = {
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
    result.diagnosis = buildDiagnosis(result);
    return result;
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
            <!-- <span class="pq-badge ${escapeHtml(diff)}">${escapeHtml(difficultyLabel(diff))}</span> -->
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

  function resultIcon(item) {
    if (item.correct) return "Correct";
    if (item.skipped) return "Skipped";
    return "Incorrect";
  }

  function renderQuestionReference(result) {
    const items = result.results || [];
    if (!items.length) return "";
    return `<details class="question-reference">
      <summary>Show full question list (${items.length})</summary>
      <div class="question-reference-list">
        ${items.map((r, i) => {
          const correctAnswer = Array.isArray(r.correct_answer) ? r.correct_answer.join(", ") : r.correct_answer;
          const studentAnswer = r.skipped ? "(no answer)" : Array.isArray(r.student_answer) ? r.student_answer.join(", ") : r.student_answer;
          const status = resultIcon(r);
          return `<div class="reference-q-card ${r.correct ? "correct" : r.skipped ? "skipped" : "incorrect"}">
            <div class="wrong-q-header">
              <span class="pq-badge ${escapeHtml(r.difficulty)}">${escapeHtml(difficultyLabel(r.difficulty))}</span>
              <span class="pq-type-badge">${escapeHtml(typeLabel(r.type))}</span>
              <span style="font-size:12px;color:var(--text3);font-family:var(--font-mono);">Q${i + 1} · ${escapeHtml(r.question_id)}</span>
              <span class="reference-status">${escapeHtml(status)}</span>
            </div>
            <div class="wrong-q-body">
              <div class="wrong-q-text">${escapeHtml(r.question_text)}</div>
              <div class="wrong-q-answers">
                <span class="${r.correct ? "wrong-q-correct" : "wrong-q-your"}">Your answer: ${escapeHtml(studentAnswer)}</span>
                <span style="color:var(--text3);">·</span>
                <span class="wrong-q-correct">Correct: ${escapeHtml(correctAnswer)}</span>
                <span style="color:var(--text3);">·</span>
                <span style="color:var(--text3);">Time: ${formatTime(r.time_taken_seconds || 0)}</span>
              </div>
              ${r.explanation ? `<div class="wrong-q-explanation">${escapeHtml(r.explanation)}</div>` : ""}
              ${r.trap ? `<div class="wrong-q-trap">Trap: ${escapeHtml(r.trap)}</div>` : ""}
            </div>
          </div>`;
        }).join("")}
      </div>
    </details>`;
  }

  function renderSmartDiagnosis(result) {
    const diagnosis = result.diagnosis || buildDiagnosis(result);
    const band = diagnosis.band || performanceBand(result.accuracy);
    const trapSample = diagnosis.trap.sample
      ? `<div class="diagnosis-trap-sample">${escapeHtml(diagnosis.trap.sample)}</div>`
      : "";
    return `<div class="smart-diagnosis">
      <div class="diagnosis-top">
        <div>
          <div class="diagnosis-eyebrow">Personal diagnosis</div>
          <h3>Your GRE Quant next step is clear</h3>
          <p>${escapeHtml(band.summary)}</p>
        </div>
        <div class="diagnosis-band ${escapeHtml(band.tone)}">
          <span>${escapeHtml(band.label)}</span>
          <b>${escapeHtml(String(result.accuracy))}%</b>
        </div>
      </div>
      <div class="diagnosis-grid">
        <div class="diagnosis-card primary">
          <span>Main issue</span>
          <b>${escapeHtml(diagnosis.main_issue)}</b>
          <p>${escapeHtml(diagnosis.weak_area.detail)}</p>
        </div>
        <div class="diagnosis-card">
          <span>Weakest zone</span>
          <b>${escapeHtml(diagnosis.weak_area.label)}</b>
          <p>${escapeHtml(diagnosis.pro_recommendation)}</p>
        </div>
        <div class="diagnosis-card">
          <span>Timing read</span>
          <b>${escapeHtml(diagnosis.timing.label)}</b>
          <p>${escapeHtml(diagnosis.timing.detail)}</p>
        </div>
        <div class="diagnosis-card">
          <span>Trap pattern</span>
          <b>${escapeHtml(diagnosis.trap.label)}</b>
          <p>${escapeHtml(diagnosis.trap.detail)}</p>
          ${trapSample}
        </div>
      </div>
      <div class="recovery-plan">
        <div>
          <div class="diagnosis-eyebrow">Recommended recovery plan</div>
          <h4>Do this before your next full mock</h4>
        </div>
        <ol>
          ${diagnosis.recovery_plan.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
        </ol>
      </div>
    </div>`;
  }

  function renderProCta(result) {
    const diagnosis = result.diagnosis || buildDiagnosis(result);
    const weakText = `${escapeHtml(diagnosis.pro_recommendation)} GRE Quant Pro turns this diagnosis into targeted drills from the full 8,410+ question bank across 88 subtopics.`;
    const wrongTraps = (result.results || []).filter((r) => !r.correct && r.trap).slice(0, 2);
    const trapText = wrongTraps.length
      ? wrongTraps.map((r) => escapeHtml(r.trap)).join(" ")
      : "Pro keeps naming the exact trap after every wrong answer so patterns stop repeating.";
    return `<div class="pro-analysis-cta">
      <div>
        <h3>This mock is the diagnosis. Pro is the practice plan.</h3>
        <p>${weakText}</p>
        <div class="pro-cta-points">
          <span>Your weak-area practice queue</span>
          <span>Trap explanations after every question</span>
          <span>Timed exam mode for real GRE pace</span>
          <span>Progress analytics across sessions</span>
        </div>
        <div class="pro-locked-grid">
          <div class="pro-locked-card"><div class="pro-locked-label">Locked in Pro</div><b>Weak subtopic map</b><span>See exactly where accuracy and time collapse across all 88 subtopics.</span></div>
          <div class="pro-locked-card"><div class="pro-locked-label">Locked in Pro</div><b>${escapeHtml(diagnosis.weak_area.label)} recovery set</b><span>Practice more questions from the area this mock exposed.</span></div>
          <div class="pro-locked-card"><div class="pro-locked-label">Locked in Pro</div><b>Trap pattern review</b><span>${trapText}</span></div>
        </div>
      </div>
      <a class="primary-btn" href="https://grequantpro.com/#plans">Unlock My Practice Plan</a>
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
    if ($("proCta")) $("proCta").innerHTML = renderSmartDiagnosis(result) + renderProCta(result);
    $("exam-wrong-section").innerHTML = renderQuestionReference(result) + renderWrongReview(result);
    $("downloadResultBtn").onclick = () => downloadJson(`${slug(result.event_id)}_${slug(result.student.name)}_result.json`, result);
    document.getElementById("emailResultBtn").onclick = async () => {
  const subject = encodeURIComponent(`GRE Quant Pro Event Result - ${result.event_name} - ${result.student.name}`);
  const bodyText = `Hi Coach Aditya,\n\nAttached/pasted below is my event result JSON.\n\n${JSON.stringify(result, null, 2)}`;
  
  // Copy full body to clipboard
  await navigator.clipboard.writeText(bodyText);

  // Open Gmail with a short nudge to paste
  const shortBody = encodeURIComponent("Hi Coach Aditya,\n\n[Paste your result here — it has been copied to your clipboard]");
  window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=goenka.aditya.kol@gmail.com&su=${subject}&body=${shortBody}`, '_blank');

  alert("Gmail is opening. The full result JSON has been copied to your clipboard — just paste it into the email body.");
};
  }

  async function saveAttempt(result) {
    try {
      await fetch(SUBMISSION_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result })
      });
    } catch (error) {
      console.warn("Could not save mock attempt", error);
    }
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
    saveAttempt(result);
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
