export const dollarsToCents = (dollars: number): string => {
  return (dollars * 100).toFixed(2);
};

export const centsToDollars = (cents: number): string => {
  return (cents / 100).toFixed(2);
};
