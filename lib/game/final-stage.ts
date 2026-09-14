export function getFinalStage(activeCount: number, participantCount: number) {
  if (participantCount < 2 || activeCount < 1) return null;
  if (activeCount === 1) return "FINAL ONE";
  if (activeCount <= 5) return "FINAL 5";
  if (activeCount <= 10) return "FINAL 10";
  return null;
}
