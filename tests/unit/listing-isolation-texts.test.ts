import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { es } from "@/bot/texts/es";
import { listingTexts, miniappTexts } from "@/miniapp/texts";

// F016, criterio 23a: ninguna pantalla ni mensaje de la separación de fichas usa un texto nuevo.
describe("criterio 23a: textos reutilizados letra por letra", () => {
  it("las claves existen y coinciden con sus valores aprobados", () => {
    expect(listingTexts.forbidden).toBe("No tienes permiso para gestionar fichas.");
    expect(listingTexts.listError).toBe("No pudimos cargar tus fichas. Inténtalo de nuevo.");
    expect(listingTexts.list.empty).toBe("Todavía no tienes fichas.");
    expect(miniappTexts.sessionExpired).toBe("Tu sesión venció o no se pudo verificar. Cierra la Mini App y ábrela de nuevo desde el bot.");
    expect(es.myListings.empty).toBe("Todavía no tienes fichas. Crea una desde la Mini App.");
    expect(es.myListings.title).toBe("Tus fichas");
    expect(es.admin.forbidden).toBe("No tienes permiso para hacer esta acción.");
  });

  it("esta funcionalidad no agrega claves ni líneas a los archivos de textos", () => {
    const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    let diff: string;
    try {
      diff = git("diff", git("merge-base", "HEAD", "main").trim(), "--", "src/bot/texts/es.ts", "src/miniapp/texts.ts");
    } catch {
      return; // sin la rama `main` (por ejemplo, una copia suelta) no hay contra qué comparar
    }
    const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    expect(added, "se agregaron líneas a los textos").toEqual([]);
  });
});
