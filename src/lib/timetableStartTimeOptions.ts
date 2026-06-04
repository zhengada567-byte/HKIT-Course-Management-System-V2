/** Day-class start times (30-min steps) for weekly grid / preferences. */
export function buildDayClassStartTimeOptions() {
  const options: string[] = [];

  for (let minutes = 8 * 60; minutes <= 14 * 60 + 30; minutes += 30) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    options.push(`${hh}:${mm}`);
  }

  return options;
}
