import { describe, expect, it } from "vitest";
import { es } from "@/bot/texts/es";
import { listingEditTexts } from "@/miniapp/texts";

// F015 (D-154): textos nuevos de la tabla "Textos nuevos" de contracts/F015.md, por igualdad exacta.
describe("textos de la edición de una ficha publicada", () => {
  it("coinciden con la tabla aprobada", () => {
    expect(listingEditTexts).toEqual({
      editPublished: "Editar ficha",
      stillVisible: "Los visitantes siguen viendo la versión publicada hasta que el administrador apruebe tu cambio.",
      rejectedEditNote: "El administrador rechazó tu último cambio. Se conserva la versión publicada. Corrígelo y envíalo de nuevo.",
    });
    expect(es.myListings.stillVisible).toBe("La versión publicada sigue visible.");
    expect(es.provider.editApproved("X")).toBe("Tu cambio a la ficha «X» fue aprobado y ya es visible para los visitantes.");
    expect(es.provider.editRejected("X", "Y")).toBe("Tu cambio a la ficha «X» fue rechazado. Motivo: Y. La versión publicada sigue visible. Puedes corregirlo y volver a enviarlo desde la Mini App.");
  });
});
