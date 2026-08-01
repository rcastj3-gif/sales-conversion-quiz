// Reference copy of the score table hardcoded in quiz.html's quizData, used to compute which
// totals are actually reachable through the real UI (rather than asserting thresholds by hand).
const Q_SCORES = {
  1: [0, 0, 0],
  2: [2, 5, 8],
  3: [2, 5, 10],
  4: [3, 5, 8],
  5: [2, 5, 10],
  // Q6 index 0 ("committed", score 15) is required to continue to Q7/Q8 at all.
  7: [0, 5, 10],
  8: [0, 5, 10],
};

const Q6_COMMITTED_SCORE = 15;

// Brute-forces every combination of the six free-choice questions on the "continue" path
// (Q1 contributes 0 regardless of choice, Q6 is fixed at "committed") to find every score the
// real UI can actually produce.
function computeAchievableScores() {
  const scores = new Set();
  for (const q2 of Q_SCORES[2]) {
    for (const q3 of Q_SCORES[3]) {
      for (const q4 of Q_SCORES[4]) {
        for (const q5 of Q_SCORES[5]) {
          for (const q7 of Q_SCORES[7]) {
            for (const q8 of Q_SCORES[8]) {
              scores.add(0 + q2 + q3 + q4 + q5 + Q6_COMMITTED_SCORE + q7 + q8);
            }
          }
        }
      }
    }
  }
  return Array.from(scores).sort((a, b) => a - b);
}

// Same brute force, but keeps one representative index combo (0/1/2 per question) per unique
// score, so a test can drive the real UI to a specific target score instead of asserting the
// threshold math by hand.
function computeAchievableCombos() {
  const bestByScore = new Map();
  for (const [q2, i2] of Q_SCORES[2].map((v, i) => [v, i])) {
    for (const [q3, i3] of Q_SCORES[3].map((v, i) => [v, i])) {
      for (const [q4, i4] of Q_SCORES[4].map((v, i) => [v, i])) {
        for (const [q5, i5] of Q_SCORES[5].map((v, i) => [v, i])) {
          for (const [q7, i7] of Q_SCORES[7].map((v, i) => [v, i])) {
            for (const [q8, i8] of Q_SCORES[8].map((v, i) => [v, i])) {
              const score = 0 + q2 + q3 + q4 + q5 + Q6_COMMITTED_SCORE + q7 + q8;
              if (!bestByScore.has(score)) {
                bestByScore.set(score, { q2: i2, q3: i3, q4: i4, q5: i5, q7: i7, q8: i8 });
              }
            }
          }
        }
      }
    }
  }
  return Array.from(bestByScore.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([score, indices]) => ({ score, indices }));
}

module.exports = { Q_SCORES, Q6_COMMITTED_SCORE, computeAchievableScores, computeAchievableCombos };
