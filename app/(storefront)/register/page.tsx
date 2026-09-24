import type { Metadata } from "next";
import { RegisterForm } from "./register-form";
import { copyValue, getSiteCopy } from "@/app/_data/site-copy";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getSiteCopy();
  return {
    title: copyValue(copy, "auth.register.metaTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function RegisterPage() {
  const copy = await getSiteCopy();
  const c = (key: string) => copyValue(copy, key);
  return (
    <div className="page-shell flex min-h-[calc(100vh-8rem)] items-center py-12">
      <section className="mx-auto w-full max-w-md rounded-3xl border bg-background p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-primary-emphasis">
          {c("auth.register.eyebrow")}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {c("auth.register.title")}
        </h1>
        <p className="mb-7 mt-2 text-sm text-muted-foreground">
          {c("auth.register.description")}
        </p>
        <RegisterForm />
      </section>
    </div>
  );
}
