const { test, expect } = require("@playwright/test");

test("dashboard tabs switch and demo data fills widgets", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:8080", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#userDashboard")).toBeVisible();
  await expect(page.locator("#jointList .joint-row")).toHaveCount(6, { timeout: 5000 });
  await expect(page.locator("#readyState")).toHaveText("Ready");
  await expect(page.locator("#rateValue")).toContainText("Hz");
  await expect(page.locator("#tcpX")).toContainText("m");
  await expect(page.locator("#trajectoryValue")).toContainText("Samples");

  await page.locator("#maintenanceViewTab").click();
  await expect(page.locator("#maintenanceDashboard")).toBeVisible();
  await expect(page.locator("#maintenanceViewTab")).toHaveClass(/active/);
  await expect(page.locator("#maintenanceHealthScore")).not.toHaveText("");
  await expect(page.locator("#axisWearList .axis-wear-item")).toHaveCount(6);
  await expect(page.locator("#mailSettingsForm")).toBeVisible();
  await page.locator("#maintenanceWindow button[data-window='7d']").click();
  await expect(page.locator("#maintenanceWindow button[data-window='7d']")).toHaveClass(/active/);

  await page.locator("#developerViewTab").click();
  await expect(page.locator("#developerDashboard")).toBeVisible();
  await expect(page.locator("#developerViewTab")).toHaveClass(/active/);
  await expect(page.locator("#packetFlowValue")).toContainText("msg");
  await expect(page.locator("#qualityValue")).not.toHaveText("-");
  await expect(page.locator("#healthList .health-item")).toHaveCount(1);
  await expect(page.locator("#messagePreview")).toContainText(/joint_states|Diagnostics/);
  await page.locator("#developerJointList .joint-row").first().hover();
  await expect(page.locator("#jointPopover")).toBeVisible();
  await expect(page.locator("#jointPopover")).toContainText("Achswinkel");

  await page.locator("#userViewTab").click();
  await expect(page.locator("#userDashboard")).toBeVisible();
  await expect(page.locator("#userViewTab")).toHaveClass(/active/);
});
