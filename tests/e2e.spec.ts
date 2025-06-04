// tests/e2e.spec.ts
import { test, expect } from "@playwright/test";

test("flujo MVP completo", async ({ page }) => {
  await page.goto("https://studio-jade-two.vercel.app/");
  // 1) Selección de técnico
  await expect(page.locator("text=Bienvenido a TechTrack")).toBeVisible();
  await page.click("text=Selecciona técnico");
  await page.click("text=RICARDO");
  await page.click("text=Continuar como RICARDO");

  // 2) Iniciar jornada
  await expect(page.locator("text=Iniciar Jornada")).toBeVisible();
  await page.click("text=Iniciar Jornada");

  // 3) Iniciar trabajo
  await expect(page.locator("text=Iniciar Trabajo")).toBeVisible();
  await page.click("text=Iniciar Trabajo");

  // 4) Escribir descripción y guardar
  await page.fill('textarea[name="description"]', "Prueba automática");
  await page.click("text=Guardar Resumen");

  // 5) Finalizar día
  await page.click("text=Terminar Jornada");

  // Validaciones finales
  await expect(page.locator("text=Día Finalizado")).toBeVisible();
});
