# Page override — Therapist review

Overrides MASTER for the therapist pages. Busy clinicians scan, so this page is **denser** (ui-ux-pro-max density ≈ 7).

- **Base size 16 px**, fine print 14 px. Spacing scale 4 / 8 / 12 / 16 / 24 / 32. Content width up to 1200 px, two columns ≥ 900 px.
- **Chart: Line Chart with Highlights** (ui-ux-pro-max `charts.csv` → Anomaly Detection / Trend Over Time):
  - Joint angle over time as a solid `--fg` line; target as a dashed `--primary` line with a direct text label.
  - Each rep is a background band: `--good-bg` / `--fair-bg` / `--poor-bg`.
  - **Flagged reps** (fair or poor) also get a **marker shape** (▲ for fair, ✕ for poor) and a number label above the peak, so they never depend on hue alone.
  - **Visible data table fallback** under/next to the chart: rep #, peak angle, time, status (icon + word), reason. Rows are buttons; Enter/click jumps the video.
  - One-sentence summary above the chart: "2 of 5 reps flagged: 1 too short (110°), 1 too fast."
- Flagged reps are listed first in a "Needs attention" strip.
- Stat tiles in a row: good reps, best angle vs target, avg rep time, pain.
