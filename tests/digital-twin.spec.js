const { test, expect } = require("@playwright/test");

/**
 * Collect canvas and label state from the browser so rendering regressions are
 * caught even when the surrounding dashboard DOM still loads correctly.
 */
async function canvasStats(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#twinCanvas");
    const rect = canvas.getBoundingClientRect();
    return {
      width: canvas.width,
      height: canvas.height,
      cssWidth: Math.round(rect.width),
      cssHeight: Math.round(rect.height),
      status: document.querySelector("#twinStatus").textContent,
    };
  });
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  /**
   * Verifies desktop and mobile framing because the WebGL canvas is resized from
   * CSS dimensions and can otherwise appear blank or undersized on one viewport.
   */
  test(`digital twin renders on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("http://127.0.0.1:8080", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#twinCanvas");
    await expect(page.locator("#twinStatus")).toHaveText(/GoFa Mesh|synchron/, { timeout: 5000 });
    await page.waitForTimeout(2500);

    const stats = await canvasStats(page);
    await page.screenshot({ path: `/tmp/sman-gofa-${viewport.name}.png` });

    expect(stats.cssWidth).toBeGreaterThan(300);
    expect(stats.cssHeight).toBeGreaterThan(300);
    expect(stats.status).toMatch(/GoFa Mesh|synchron/);
  });
}
