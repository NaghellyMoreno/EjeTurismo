import { expect, type Page } from "@playwright/test";

// D-206: formulario por pasos de la ficha (1 Tipo, 2 Información, 3 Guardar borrador, 4 Fotografías, 5 Revisar y enviar).
// Avanza o retrocede hasta el paso pedido. Para pasar del paso 3 al 4 hace falta guardar: si el borrador no está guardado,
// lo guarda con su confirmación, como lo haría la persona.
export async function toStep(page: Page, target: 1 | 2 | 3 | 4 | 5) {
  const caption = page.getByTestId("wizard-step");
  for (let i = 0; i < 8; i++) {
    const current = Number(/Paso (\d)/.exec(await caption.innerText())?.[1]);
    if (current === target) return;
    if (current > target) {
      await page.getByTestId(current === 4 ? "wizard-previous-photos" : "wizard-previous").click();
    } else if (current === 3 && (await page.getByTestId("listing-save").count()) > 0) {
      await page.getByTestId("listing-save").click();
      await page.getByTestId("listing-confirm-yes").click();
    } else {
      await page.getByTestId(current === 4 ? "wizard-next-photos" : "wizard-next").click();
    }
    await expect(caption).not.toHaveText(`Paso ${current} de 5`);
  }
  await expect(caption).toHaveText(`Paso ${target} de 5`);
}
