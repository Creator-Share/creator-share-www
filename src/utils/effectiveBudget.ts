// Utility to determine effective budget goal in cents.
// Reads HARDCODE_CHILD_BUDGET_PRICE_CENTS (server-side) and falls back to DB value.
// Also provides a helper for front-end code to read NEXT_PUBLIC_HARDCODE_CHILD_BUDGET_PRICE_CENTS.
export function getHardcodedBudgetCents(): number | null {
  const raw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL;
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && !isNaN(parsed) ? parsed : null;
}

export function getEffectiveGoalCents(dbBudgetGoalCents?: number | null): number {
  const hard = getHardcodedBudgetCents();
  if (hard !== null) return hard;
  return typeof dbBudgetGoalCents === "number" ? dbBudgetGoalCents : 0;
}