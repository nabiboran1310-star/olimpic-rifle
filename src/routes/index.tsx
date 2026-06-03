import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ISSF 10m Air Rifle — Olympic Simulator" },
      { name: "description", content: "Strict 10-meter Air Rifle shooting simulator with Olympic broadcast presentation." },
    ],
  }),
  component: () => null,
});
