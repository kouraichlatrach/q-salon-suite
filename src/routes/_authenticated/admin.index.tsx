import { createFileRoute } from "@tanstack/react-router";
import { AdminBrandsList } from "./admin";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Brands — Platform admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminBrandsList,
});
