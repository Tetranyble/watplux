import { expect, type Page, type TestInfo } from "@playwright/test";

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

export async function expectNoSeriousConsoleErrors(
  page: Page,
): Promise<() => string[]> {
  const errors: string[] = [];
  const listener = (message: import("@playwright/test").ConsoleMessage) => {
    if (message.type() === "error") errors.push(message.text());
  };
  page.on("console", listener);
  return () => {
    page.off("console", listener);
    return errors;
  };
}

export async function attachFullPageScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  const body = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

/**
 * Dependency-free release accessibility smoke. This deliberately checks a
 * small set of high-severity structural failures that we can enforce in every
 * environment without introducing a second browser-analysis dependency.
 * It is not advertised as a complete WCAG audit; Phase 16 documents the
 * remaining manual/assistive-technology pass required before launch.
 */
export async function expectCriticalAccessibilityBasics(
  page: Page,
): Promise<void> {
  const issues = await page.evaluate(() => {
    const failures: string[] = [];
    if (!document.documentElement.lang.trim())
      failures.push("html element has no lang");
    if (!document.querySelector("main"))
      failures.push("page has no main landmark");

    const ids = new Map<string, number>();
    for (const element of document.querySelectorAll<HTMLElement>("[id]")) {
      const id = element.id;
      ids.set(id, (ids.get(id) ?? 0) + 1);
    }
    for (const [id, count] of ids) {
      if (count > 1) failures.push(`duplicate id: ${id}`);
    }

    const visible = (element: Element) => {
      const html = element as HTMLElement;
      const style = window.getComputedStyle(html);
      return style.display !== "none" && style.visibility !== "hidden";
    };

    const accessibleName = (element: Element) =>
      element.getAttribute("aria-label")?.trim() ||
      element.getAttribute("title")?.trim() ||
      element.textContent?.trim() ||
      "";

    for (const image of document.querySelectorAll("img")) {
      if (!image.hasAttribute("alt"))
        failures.push("image missing alt attribute");
    }

    for (const element of document.querySelectorAll("button, a[href]")) {
      if (visible(element) && !accessibleName(element)) {
        failures.push(
          `${element.tagName.toLowerCase()} has no accessible name`,
        );
      }
    }

    for (const control of document.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input:not([type='hidden']), select, textarea")) {
      if (!visible(control)) continue;
      const labelled =
        Boolean(control.getAttribute("aria-label")) ||
        Boolean(control.getAttribute("aria-labelledby")) ||
        Boolean(
          control.id &&
          document.querySelector(`label[for="${CSS.escape(control.id)}"]`),
        ) ||
        Boolean(control.closest("label"));
      if (!labelled)
        failures.push(
          `${control.tagName.toLowerCase()}#${control.id || "(no-id)"} is unlabelled`,
        );

      const describedBy = control.getAttribute("aria-describedby");
      if (describedBy) {
        for (const id of describedBy.split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(id))
            failures.push(`aria-describedby target missing: ${id}`);
        }
      }
    }

    return failures;
  });

  expect(issues, issues.join("\n")).toEqual([]);
}
