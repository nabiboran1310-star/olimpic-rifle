import { createFileRoute } from "@tanstack/react-router";
import AirRifleGame from "@/components/AirRifleGame";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ISSF 10m Air Rifle — Olympic Simulator" },
      { name: "description", content: "Strict 10-meter Air Rifle shooting simulator with Olympic broadcast presentation." },
      { property: "og:title", content: "ISSF 10m Air Rifle — Olympic Simulator" },
      { property: "og:description", content: "Strict 10-meter Air Rifle shooting simulator with Olympic broadcast presentation." },
    ],
  }),
  component: AirRifleGame,
});
