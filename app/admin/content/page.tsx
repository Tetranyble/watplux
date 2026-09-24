import { redirect } from "next/navigation";

export const instant = false;

export default function WebsiteCopyPage() {
  redirect("/admin/content/site");
}
