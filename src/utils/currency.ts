export const dollarsToCents = (dollars: number): string => {
  return Math.round(dollars * 100).toString();
};

export const centsToDollars = (cents: number): string => {
  return (cents / 100).toFixed(2);
};
