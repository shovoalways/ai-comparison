(function () {
  'use strict';

  /* ========================================================================
     Pure calculation functions
     ======================================================================== */

  var KCAL_PER_KG = 7700;
  var STEP_TARGET_CAP = 15000;
  var TIMELINE_WEEKS = 12;

  // Mifflin-St Jeor resting energy: 10w + 6.25h - 5a, +5 for men, -161 for women.
  function calcBmr(weightKg, heightCm, age, sex) {
    var base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return sex === 'male' ? base + 5 : base - 161;
  }

  // Maps average daily steps to an activity multiplier bracket.
  function activityMultiplier(steps) {
    if (steps < 5000) return 1.2;
    if (steps < 7500) return 1.375;
    if (steps < 10000) return 1.5;
    if (steps < 12500) return 1.65;
    return 1.8;
  }

  // Total daily energy expenditure is resting energy scaled by activity.
  function calcTdee(bmr, multiplier) {
    return bmr * multiplier;
  }

  // Calorie target: -20% for fat loss, +10% for lean gain, TDEE for maintenance.
  function calcCalories(tdee, goal) {
    if (goal === 'cut') return tdee * 0.8;
    if (goal === 'gain') return tdee * 1.1;
    return tdee;
  }

  // Protein: 1.8 g/kg when cutting or gaining, 1.4 g/kg when maintaining.
  function calcProteinGrams(weightKg, goal) {
    return weightKg * (goal === 'maintain' ? 1.4 : 1.8);
  }

  // Fat: 25% of total calories at 9 kcal per gram.
  function calcFatGrams(calories) {
    return (calories * 0.25) / 9;
  }

  // Carbs: whatever calories remain after protein and fat, at 4 kcal per gram.
  function calcCarbGrams(calories, proteinG, fatG) {
    return Math.max(0, (calories - proteinG * 4 - fatG * 9) / 4);
  }

  // Water: 35 ml/kg plus 350 ml for each full 5000 steps above 5000.
  function calcWaterMl(weightKg, steps) {
    var extraBlocks = steps > 5000 ? Math.floor((steps - 5000) / 5000) : 0;
    return weightKg * 35 + extraBlocks * 350;
  }

  // Step target: current + 15%, capped at 15000 but never below what you already do.
  function calcStepTarget(steps) {
    var target = Math.min(steps * 1.15, STEP_TARGET_CAP);
    return Math.round(Math.max(target, steps));
  }

  // Weekly weight change in kg from the daily calorie delta (7700 kcal ≈ 1 kg).
  function calcWeeklyChangeKg(calories, tdee) {
    return ((calories - tdee) * 7) / KCAL_PER_KG;
  }

  // Runs every calculation and returns one plain result object.
  function calculateTargets(input) {
    var bmr = calcBmr(input.weight, input.height, input.age, input.sex);
    var multiplier = activityMultiplier(input.steps);
    var tdee = calcTdee(bmr, multiplier);
    var calories = calcCalories(tdee, input.goal);
    var protein = calcProteinGrams(input.weight, input.goal);
    var fat = calcFatGrams(calories);
    var carbs = calcCarbGrams(calories, protein, fat);

    return {
      bmr: bmr,
      multiplier: multiplier,
      tdee: tdee,
      calories: calories,
      protein: protein,
      fat: fat,
      carbs: carbs,
      waterMl: calcWaterMl(input.weight, input.steps),
      stepTarget: calcStepTarget(input.steps),
      weeklyChangeKg: calcWeeklyChangeKg(calories, tdee)
    };
  }

  // Builds the one-line weekly change + rough timeline summary.
  function buildSummary(goal, weeklyChangeKg) {
    if (goal === 'maintain') {
      return 'Estimated weekly change: about 0 kg. Your weight should stay roughly stable.';
    }
    var sign = weeklyChangeKg > 0 ? '+' : '−';
    var weekly = Math.abs(weeklyChangeKg).toFixed(2);
    var total = Math.abs(weeklyChangeKg * TIMELINE_WEEKS).toFixed(1);
    var verb = weeklyChangeKg > 0 ? 'gain' : 'loss';
    return 'Estimated weekly change: ' + sign + weekly + ' kg. At this pace, expect roughly ' +
      total + ' kg of ' + verb + ' over ' + TIMELINE_WEEKS + ' weeks.';
  }

  /* ========================================================================
     DOM wiring
     ======================================================================== */

  var FIELD_RULES = {
    weight: { label: 'Weight', unit: ' kg', type: 'number' },
    age: { label: 'Age', unit: '', type: 'number', integer: true },
    sex: { label: 'Sex', type: 'select' },
    height: { label: 'Height', unit: ' cm', type: 'number' },
    steps: { label: 'Average daily steps', unit: '', type: 'number', integer: true },
    goal: { label: 'Goal', type: 'select' }
  };

  function formatNumber(value, decimals) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimals || 0,
      maximumFractionDigits: decimals || 0
    });
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function errorMessageFor(el, rule) {
    var v = el.validity;
    if (rule.type === 'select') {
      return v.valueMissing ? 'Please choose your ' + rule.label.toLowerCase() + '.' : '';
    }
    if (v.badInput) return 'Enter a valid number.';
    if (v.valueMissing) return 'Please enter your ' + rule.label.toLowerCase() + '.';
    if (v.rangeUnderflow || v.rangeOverflow) {
      return rule.label + ' must be between ' + formatNumber(Number(el.min)) + ' and ' +
        formatNumber(Number(el.max)) + rule.unit + '.';
    }
    if (v.stepMismatch) {
      return rule.integer ? 'Use a whole number.' : 'Round to the nearest ' + el.step + rule.unit + '.';
    }
    return v.valid ? '' : 'Please check this value.';
  }

  function setFieldError(el, message) {
    var errorEl = document.getElementById(el.id + '-error');
    errorEl.textContent = message;
    if (message) {
      el.setAttribute('aria-invalid', 'true');
    } else {
      el.removeAttribute('aria-invalid');
    }
  }

  function validateField(el) {
    var message = errorMessageFor(el, FIELD_RULES[el.id]);
    setFieldError(el, message);
    return message === '';
  }

  function validateForm(form) {
    var firstInvalid = null;
    Object.keys(FIELD_RULES).forEach(function (id) {
      var el = form.elements[id];
      if (!validateField(el) && !firstInvalid) firstInvalid = el;
    });
    if (firstInvalid) firstInvalid.focus();
    return firstInvalid === null;
  }

  function readInput(form) {
    var el = form.elements;
    return {
      weight: Number(el.weight.value),
      age: Number(el.age.value),
      sex: el.sex.value,
      height: Number(el.height.value),
      steps: Number(el.steps.value),
      goal: el.goal.value
    };
  }

  function isInputUsable(input) {
    return [input.weight, input.age, input.height, input.steps].every(Number.isFinite) &&
      (input.sex === 'male' || input.sex === 'female') &&
      ['cut', 'maintain', 'gain'].indexOf(input.goal) !== -1;
  }

  function renderResults(input, r) {
    var text = function (id, value) { document.getElementById(id).textContent = value; };

    text('out-calories', formatNumber(Math.round(r.calories / 10) * 10));
    text('out-calories-note', 'Maintenance ≈ ' + formatNumber(Math.round(r.tdee / 10) * 10) +
      ' kcal (activity ×' + r.multiplier + ')');
    text('out-protein', formatNumber(Math.round(r.protein)));
    text('out-protein-note', (input.goal === 'maintain' ? '1.4' : '1.8') + ' g per kg of body weight');
    text('out-carbs', formatNumber(Math.round(r.carbs)));
    text('out-fat', formatNumber(Math.round(r.fat)));
    text('out-water', formatNumber(r.waterMl / 1000, 1));
    text('out-steps', formatNumber(r.stepTarget));
    text('out-steps-note', input.steps >= STEP_TARGET_CAP
      ? 'Great base — hold this level'
      : 'Up from ' + formatNumber(input.steps) + ' a day');
    text('out-summary', buildSummary(input.goal, r.weeklyChangeKg));
  }

  function revealResults(section) {
    section.classList.remove('is-visible');
    section.hidden = false;
    void section.offsetHeight; // force reflow so the transition replays on every calculation
    section.classList.add('is-visible');
    section.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    section.focus({ preventScroll: true });
  }

  function hideResults(section) {
    section.classList.remove('is-visible');
    section.hidden = true;
  }

  function init() {
    var form = document.getElementById('calc-form');
    var results = document.getElementById('results');
    var recalc = document.getElementById('recalc');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!validateForm(form)) {
        hideResults(results);
        return;
      }
      var input = readInput(form);
      if (!isInputUsable(input)) {
        hideResults(results);
        return;
      }
      renderResults(input, calculateTargets(input));
      revealResults(results);
    });

    // Clear a field's error as soon as it becomes valid; re-check on blur once touched.
    Object.keys(FIELD_RULES).forEach(function (id) {
      var el = form.elements[id];
      var onChange = function () {
        if (el.getAttribute('aria-invalid') === 'true') validateField(el);
        if (!el.checkValidity()) hideResults(results); // never leave results next to invalid input
      };
      el.addEventListener('input', onChange);
      el.addEventListener('change', onChange);
      el.addEventListener('blur', function () {
        if (el.value !== '') validateField(el);
      });
    });

    recalc.addEventListener('click', function () {
      form.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      form.elements.weight.focus({ preventScroll: true });
    });
  }

  init();
})();
