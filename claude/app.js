/*
 * Body Target Calculator
 *
 * 1. Pure calculations: numbers in, numbers out, no DOM access.
 * 2. Formatting: turns those numbers into display text.
 * 3. DOM wiring: validation, rendering and events.
 *
 * Everything lives inside this IIFE, so nothing leaks onto `window`.
 * The only thing that runs on load is the init() call at the very bottom.
 */
(function () {
  "use strict";

  /* ======================================================================
     1. Pure calculations
     ====================================================================== */

  const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 };
  const KCAL_PER_KG_BODY_WEIGHT = 7700;
  const FAT_SHARE_OF_CALORIES = 0.25;
  const STEP_TARGET_CAP = 15000;

  // Per goal: calorie change vs. maintenance, and protein per kg of body weight.
  const GOALS = {
    "fat-loss": { calorieAdjust: -0.2, proteinPerKg: 1.8 },
    maintain: { calorieAdjust: 0, proteinPerKg: 1.4 },
    "lean-gain": { calorieAdjust: 0.1, proteinPerKg: 1.8 },
  };

  // Daily-step bands, highest first, and the activity multiplier for each.
  const ACTIVITY_BANDS = [
    { minSteps: 12500, multiplier: 1.8 },
    { minSteps: 10000, multiplier: 1.65 },
    { minSteps: 7500, multiplier: 1.5 },
    { minSteps: 5000, multiplier: 1.375 },
    { minSteps: 0, multiplier: 1.2 },
  ];

  // BMR (Mifflin-St Jeor): 10 × kg + 6.25 × cm − 5 × age, then +5 for males or −161 for females.
  function calcBmr(weightKg, heightCm, age, sex) {
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return sex === "male" ? base + 5 : base - 161;
  }

  // Activity multiplier looked up from average daily steps instead of a self-rated level.
  function activityMultiplier(steps) {
    return ACTIVITY_BANDS.find((band) => steps >= band.minSteps).multiplier;
  }

  // TDEE: resting burn (BMR) scaled up by the activity multiplier.
  function calcTdee(bmr, multiplier) {
    return bmr * multiplier;
  }

  // Calorie target: TDEE −20% for fat loss, unchanged to maintain, +10% for lean gain.
  function targetCalories(tdee, goal) {
    return tdee * (1 + GOALS[goal].calorieAdjust);
  }

  // Protein grams: 1.8 g per kg for fat loss and lean gain, 1.4 g per kg to maintain.
  function proteinGrams(weightKg, goal) {
    return weightKg * GOALS[goal].proteinPerKg;
  }

  // Fat grams: 25% of calories divided by 9 kcal per gram.
  function fatGrams(calories) {
    return (calories * FAT_SHARE_OF_CALORIES) / KCAL_PER_GRAM.fat;
  }

  // Carb grams: calories left after protein and fat, divided by 4 kcal per gram (never below 0).
  function carbGrams(calories, proteinG, fatG) {
    const remaining = calories - proteinG * KCAL_PER_GRAM.protein - fatG * KCAL_PER_GRAM.fat;
    return Math.max(0, remaining) / KCAL_PER_GRAM.carbs;
  }

  // Activity water: 350 ml for each full 5,000 steps above the first 5,000.
  function stepWaterMl(steps) {
    return Math.floor(Math.max(0, steps - 5000) / 5000) * 350;
  }

  // Daily water: 35 ml per kg of body weight plus the activity water.
  function waterMl(weightKg, steps) {
    return weightKg * 35 + stepWaterMl(steps);
  }

  // Step target: current average plus 15%, capped at 15,000, but never below the current average.
  function stepTarget(steps) {
    return Math.max(Math.min(Math.round(steps * 1.15), STEP_TARGET_CAP), steps);
  }

  // Weekly weight change in kg: daily calorie delta × 7 days ÷ 7,700 kcal per kg.
  function weeklyChangeKg(calories, tdee) {
    return ((calories - tdee) * 7) / KCAL_PER_KG_BODY_WEIGHT;
  }

  // Runs every calculation for one validated input and returns unrounded numbers.
  function calculateTargets(input) {
    const bmr = calcBmr(input.weightKg, input.heightCm, input.age, input.sex);
    const multiplier = activityMultiplier(input.steps);
    const tdee = calcTdee(bmr, multiplier);
    const calories = targetCalories(tdee, input.goal);
    const protein = proteinGrams(input.weightKg, input.goal);
    const fat = fatGrams(calories);

    return {
      bmr,
      multiplier,
      tdee,
      calories,
      protein,
      fat,
      carbs: carbGrams(calories, protein, fat),
      waterMl: waterMl(input.weightKg, input.steps),
      stepWaterMl: stepWaterMl(input.steps),
      stepTarget: stepTarget(input.steps),
      weeklyKg: weeklyChangeKg(calories, tdee),
    };
  }

  /* ======================================================================
     2. Formatting
     ====================================================================== */

  const MINUS = "−";
  const LOW_CALORIE_THRESHOLD = 1200;
  const formatWhole = new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format;
  const formatOneDecimal = new Intl.NumberFormat("en", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format;
  const formatTwoDecimals = new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format;

  // Prefixes "+" or "−", unless the value rounds to zero.
  function withSign(value, format) {
    const text = format(Math.abs(value));
    if (Number(text.replace(/,/g, "")) === 0) return text;
    return (value < 0 ? MINUS : "+") + text;
  }

  // A macro's share of the day's calories, e.g. "50% of calories".
  function shareOfCalories(grams, kcalPerGram, calories) {
    return Math.round(((grams * kcalPerGram) / calories) * 100) + "% of calories";
  }

  // How the calorie target relates to maintenance (with a caution for very low deficits).
  function describeCalories(calorieAdjust, calories) {
    if (calorieAdjust < 0 && calories < LOW_CALORIE_THRESHOLD) {
      return "Under 1,200 kcal: check with a professional first";
    }
    if (calorieAdjust === 0) return "Same as maintenance";
    const percent = Math.round(Math.abs(calorieAdjust) * 100);
    return percent + "% " + (calorieAdjust < 0 ? "below" : "above") + " maintenance";
  }

  // Where the step target came from, including when the cap kicks in.
  function describeSteps(steps, target) {
    if (steps >= STEP_TARGET_CAP) return "Already at 15,000+, so keep this level";
    if (target === STEP_TARGET_CAP) return "+15%, capped at 15,000";
    return "+15% on your " + formatWhole(steps) + " average";
  }

  // Weekly change headline plus a rough 4- and 12-week timeline.
  function describeChange(weeklyKg) {
    const perWeek = withSign(weeklyKg, formatTwoDecimals);

    if (Number(perWeek) === 0) {
      return {
        lead: "Estimated change: about 0 kg per week.",
        detail: "Your weight should stay roughly where it is.",
        trend: "flat",
      };
    }

    return {
      lead: "Estimated change: " + perWeek + " kg per week.",
      detail:
        "Roughly " + withSign(weeklyKg * 4, formatOneDecimal) + " kg in 4 weeks and " +
        withSign(weeklyKg * 12, formatOneDecimal) + " kg in 12 weeks.",
      trend: weeklyKg < 0 ? "down" : "up",
    };
  }

  // Maps raw targets to the strings shown in each [data-out] slot.
  function formatTargets(input, t, goalLabel) {
    const goal = GOALS[input.goal];
    const change = describeChange(t.weeklyKg);

    return {
      goal: goalLabel,
      bmr: formatWhole(t.bmr),
      multiplier: "×" + t.multiplier,
      tdee: formatWhole(t.tdee),
      calories: formatWhole(t.calories),
      caloriesNote: describeCalories(goal.calorieAdjust, t.calories),
      protein: formatWhole(t.protein),
      proteinNote: goal.proteinPerKg + " g per kg of body weight",
      carbs: formatWhole(t.carbs),
      carbsNote: shareOfCalories(t.carbs, KCAL_PER_GRAM.carbs, t.calories),
      fat: formatWhole(t.fat),
      fatNote: shareOfCalories(t.fat, KCAL_PER_GRAM.fat, t.calories),
      // Round at the 100 ml level first so 3,150 ml shows as 3.2 L, not 3.1.
      water: formatOneDecimal(Math.round(t.waterMl / 100) / 10),
      waterNote:
        t.stepWaterMl > 0
          ? "35 ml/kg + " + formatWhole(t.stepWaterMl) + " ml for your steps"
          : "35 ml per kg of body weight",
      steps: formatWhole(t.stepTarget),
      stepsNote: describeSteps(input.steps, t.stepTarget),
      summaryLead: change.lead,
      summaryDetail: change.detail,
      trend: change.trend,
    };
  }

  /* ======================================================================
     3. DOM wiring
     ====================================================================== */

  const FIELD_NAMES = ["weight", "age", "sex", "height", "steps", "goal"];

  // Inline error text. {min} and {max} are filled from each input's own attributes.
  const ERROR_TEXT = {
    weight: { missing: "Enter your weight.", range: "Enter a weight between {min} and {max} kg." },
    age: { missing: "Enter your age.", range: "Enter an age between {min} and {max}." },
    sex: { missing: "Select your sex." },
    height: { missing: "Enter your height.", range: "Enter a height between {min} and {max} cm." },
    steps: { missing: "Enter your average daily steps.", range: "Enter a step count between {min} and {max}." },
    goal: { missing: "Select a goal." },
  };

  // Picks the message for a field's current validity state ("" when it's valid).
  function errorMessageFor(field) {
    const state = field.validity;
    const text = ERROR_TEXT[field.name];

    if (state.valid) return "";
    if (state.badInput) return "Enter a number.";
    if (state.valueMissing) return text.missing;
    if (state.rangeUnderflow || state.rangeOverflow) {
      return text.range
        .replace("{min}", formatWhole(Number(field.min)))
        .replace("{max}", formatWhole(Number(field.max)));
    }
    if (state.stepMismatch) {
      return field.step === "1" ? "Use a whole number." : "Use no more than one decimal place.";
    }
    return field.validationMessage;
  }

  // Shows or clears the message under a field and keeps aria-invalid in sync.
  function setFieldError(field, message) {
    document.getElementById(field.id + "-error").textContent = message;
    if (message) {
      field.setAttribute("aria-invalid", "true");
    } else {
      field.removeAttribute("aria-invalid");
    }
  }

  // Validates one field, updates its inline error and returns true if it passed.
  function validateField(field) {
    const message = errorMessageFor(field);
    setFieldError(field, message);
    return message === "";
  }

  // Reads the (already validated) form into typed values.
  function readInput(form) {
    const el = form.elements;
    return {
      weightKg: el.weight.valueAsNumber,
      age: el.age.valueAsNumber,
      sex: el.sex.value,
      heightCm: el.height.valueAsNumber,
      steps: el.steps.valueAsNumber,
      goal: el.goal.value,
    };
  }

  // Writes each formatted value into its [data-out] element and swaps the trend icon.
  function renderResults(section, view) {
    section.querySelectorAll("[data-out]").forEach((node) => {
      node.textContent = view[node.dataset.out];
    });
    document.getElementById("trend-icon").setAttribute("href", "#i-trend-" + view.trend);
  }

  // Unhides the results and (re)plays the CSS fade/slide-in.
  function showResults(section) {
    section.classList.remove("is-visible");
    section.hidden = false;
    void section.offsetWidth; // Flush styles so the transition starts from the hidden state.
    section.classList.add("is-visible");
  }

  // Hides the results straight away.
  function hideResults(section) {
    section.hidden = true;
    section.classList.remove("is-visible");
  }

  function init() {
    const form = document.getElementById("calculator");
    const results = document.getElementById("results");
    const fields = FIELD_NAMES.map((name) => form.elements[name]);

    // Keep the native constraints, but show our inline messages instead of browser bubbles.
    form.noValidate = true;

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      const invalid = fields.filter((field) => !validateField(field));
      if (invalid.length > 0) {
        hideResults(results);
        invalid[0].focus();
        return;
      }

      const input = readInput(form);
      const goalLabel = form.elements.goal.selectedOptions[0].textContent;
      renderResults(results, formatTargets(input, calculateTargets(input), goalLabel));
      showResults(results);
      document.getElementById("results-title").focus({ preventScroll: true });
      results.scrollIntoView({ block: "start" });
    });

    // Any edit makes the shown results stale; a field already showing an error re-checks as you type.
    form.addEventListener("input", (event) => {
      hideResults(results);
      if (event.target.hasAttribute("aria-invalid")) validateField(event.target);
    });

    // Check a field once the user commits a change (leaving an input, picking an option).
    form.addEventListener("change", (event) => {
      if (fields.includes(event.target)) validateField(event.target);
    });

    // Stop the mouse wheel from quietly changing a focused number field while scrolling.
    form.addEventListener(
      "wheel",
      (event) => {
        const target = event.target;
        if (target.type === "number" && target === document.activeElement) target.blur();
      },
      { passive: true }
    );

    document.getElementById("recalculate").addEventListener("click", () => {
      document.getElementById("form-title").focus({ preventScroll: true });
      form.scrollIntoView({ block: "start" });
    });
  }

  init();
})();
