import { screen } from "@testing-library/react";

import { renderWithProviders } from "__support__/ui";

import {
  RetentionProjection,
  type RetentionProjectionData,
} from "./RetentionProjection";

const SAMPLE: RetentionProjectionData = {
  game: "Hamster Jump",
  installs: 21714,
  cohort_date: "2026-06-07T00:00:00Z",
  prefix_last: 18,
  dropped_tail_days: [23],
  trimmed_tail_days: [19, 20, 21, 22],
  milestones: {
    "30": { retention: 0.02085, retention_pct: 2.085 },
    "60": { retention: 0.002783, retention_pct: 0.2783 },
    "90": { retention: 0.001042, retention_pct: 0.1042 },
    "120": { retention: 0.000462, retention_pct: 0.0462 },
  },
  curve: [
    {
      day: 1,
      retention: 0.401,
      retention_pct: 40.1,
      observed: true,
      projected: false,
    },
    {
      day: 17,
      retention: 0.03,
      retention_pct: 3.0,
      observed: true,
      projected: false,
    },
    {
      day: 18,
      retention: 0.028,
      retention_pct: 2.8,
      observed: true,
      projected: true,
    },
    {
      day: 30,
      retention: 0.02085,
      retention_pct: 2.085,
      observed: false,
      projected: true,
    },
    {
      day: 120,
      retention: 0.000462,
      retention_pct: 0.0462,
      observed: false,
      projected: true,
    },
  ],
};

describe("RetentionProjection", () => {
  it("renders the title from the game name", () => {
    renderWithProviders(<RetentionProjection data={SAMPLE} />);
    expect(
      screen.getByText("Hamster Jump — retention projection"),
    ).toBeInTheDocument();
  });

  it("renders the milestone percentages", () => {
    renderWithProviders(<RetentionProjection data={SAMPLE} />);
    expect(screen.getByText("2.08%")).toBeInTheDocument(); // d30 2.085
    expect(screen.getByText("0.28%")).toBeInTheDocument(); // d60 0.2783
    expect(screen.getByText("0.10%")).toBeInTheDocument(); // d90 0.1042
    expect(screen.getByText("0.05%")).toBeInTheDocument(); // d120 0.0462
  });

  it("builds a subtitle describing installs, cohort, observed/projected range, and held-back days", () => {
    renderWithProviders(<RetentionProjection data={SAMPLE} />);
    const subtitle = screen.getByText(/installs · cohort/);
    expect(subtitle).toHaveTextContent("21,714 installs");
    expect(subtitle).toHaveTextContent("cohort 2026-06-07");
    expect(subtitle).toHaveTextContent("observed d0–d18 → projected to d120");
    expect(subtitle).toHaveTextContent("dropped immature tail d23–d23");
    expect(subtitle).toHaveTextContent("held back last 4 days (d19–d22)");
  });

  it("renders the retention curve svg", () => {
    renderWithProviders(<RetentionProjection data={SAMPLE} />);
    expect(
      screen.getByTestId("pivot-retention-projection"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /retention curve/i }),
    ).toBeInTheDocument();
  });

  it("falls back to a generic title when no game is given", () => {
    renderWithProviders(
      <RetentionProjection data={{ ...SAMPLE, game: undefined }} />,
    );
    expect(screen.getByText("Retention projection")).toBeInTheDocument();
  });
});
