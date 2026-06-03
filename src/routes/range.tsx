import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/range")({
  head: () => ({
    meta: [
      { title: "Тир — Olympic Rifle Simulator" },
      { name: "description", content: "Игровой экран стрельбы." },
    ],
  }),
  component: () => null,
});
