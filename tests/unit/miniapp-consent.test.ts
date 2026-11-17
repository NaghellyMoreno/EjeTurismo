import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { es } from "@/bot/texts/es";
import { protectedText, revokeConfirmText } from "@/miniapp/home";
import { noticeText } from "@/miniapp/notice";
import { miniappTexts } from "@/miniapp/texts";
import { buildNoticeMessages } from "@/lib/notice";
import type { components } from "@/shared/api/schema";
import { readNoticeSource } from "../helpers/notice-source";

type Me = components["schemas"]["Me"];

// F036, criterios 2, 37 y 38.
const me = (roles: Me["roles"]): Me => ({
  telegramUserId: "900000371",
  displayName: null,
  consent: { required: false, currentVersion: "v", acceptedVersion: "v", acceptedAt: null, canRevoke: true },
  roles,
  isPrincipalAdmin: false,
  providerRegistrationStatus: "none",
  canRegisterAsProvider: false,
});

describe("37: textos de M01, M02 y M03", () => {
  const NEW_KEYS = ["declined", "noticeError", "acceptError"] as const;

  it("las claves nuevas no llevan dígitos, ni la palabra código, ni /start", () => {
    for (const key of NEW_KEYS) {
      expect(miniappTexts[key], key).toBeTruthy();
      expect(miniappTexts[key], key).not.toMatch(/\d|código|\/start/i);
    }
  });

  it("los textos aprobados son los de D-142", () => {
    expect(miniappTexts.declined).toBe("Sin tu autorización no podemos guardar ningún dato. Si cambias de opinión, pulsa «Volver a ver el aviso»");
    expect(miniappTexts.noticeError).toBe("No pudimos mostrar el aviso de privacidad. Cierra la Mini App y ábrela de nuevo en unos minutos");
    expect(miniappTexts.acceptError).toBe("No pudimos registrar tu aceptación. Inténtalo de nuevo en unos minutos");
  });

  it("miniapp.consentRequired ya no existe", () => {
    expect("consentRequired" in miniappTexts).toBe(false);
  });

  it("los textos compartidos se citan de es.ts y no se copian", () => {
    const sources = ["src/miniapp/home-screen.tsx", "src/miniapp/home.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
    for (const shared of [es.notice.accept, es.notice.decline, es.selfRevoke.button, es.selfRevoke.confirm, es.selfRevoke.note, es.decline.showAgain]) {
      expect(sources.includes(shared), shared).toBe(false);
    }
    expect(sources).toContain("es.selfRevoke.button");
    expect(sources).toContain("es.notice.accept");
  });

  it("la confirmación sale de los roles de getMe", () => {
    expect(revokeConfirmText(me([]))).toBe(es.selfRevoke.confirm);
    expect(revokeConfirmText(me(["provider"]))).toBe(es.selfRevoke.confirmProvider);
    expect(revokeConfirmText(me(["admin"]))).toBe(es.selfRevoke.confirmAdmin);
    expect(revokeConfirmText(me(["admin", "provider"]))).toBe(es.selfRevoke.confirmProviderAdmin);
  });

  it("el motivo del 409 es el detail del servidor", () => {
    expect(protectedText("principal_admin_protected")).toBe(es.selfRevoke.principalProtected);
    expect(protectedText("last_admin_protected")).toBe(es.selfRevoke.lastAdminProtected);
    expect(protectedText("forbidden")).toBeNull();
    expect(protectedText(undefined)).toBeNull();
  });
});

describe("2: el texto de M01 es la unión de los 3 mensajes del bot", () => {
  const source = readNoticeSource();
  const notice = { version: "2026-11-v3", bodyMarkdown: source.body, declarationText: source.declaration, publishedAt: "2026-11-16T03:30:00.000Z" };

  it("coincide con buildNoticeMessages unido con una línea en blanco, sin marcas ni marcador de fecha", () => {
    const expected = buildNoticeMessages({ ...notice, publishedAt: new Date(notice.publishedAt) }).join("\n\n");
    expect(noticeText(notice)).toBe(expected);
    expect(expected).not.toMatch(/\[(Confirmado|Inferido|Pendiente)|\[fecha de publicación/);
    expect(expected).toContain("2026-11-v3");
  });

  it("si el aviso no tiene los apartados esperados devuelve nulo y no se muestran botones", () => {
    expect(noticeText({ ...notice, bodyMarkdown: "solo título" })).toBeNull();
  });
});

describe("38: identidad visual", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });

  it("ningún archivo de src/miniapp ni src/app fija un color hexadecimal fuera de globals.css", () => {
    const files = [...walk("src/miniapp"), ...walk("src/app")].filter((f) => /\.(ts|tsx)$/.test(f));
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("los botones de F036 usan las variables de estilo", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const block = css.slice(css.indexOf(".screen .actions button.primary"));
    expect(block).toMatch(/button\.primary \{[^}]*var\(--color-primary-dark\)[^}]*color: #fff/);
    expect(css).not.toMatch(/#(?!(?:659287|3f6b5f|88bda4|b1d3b9|e6f2dd|c1ff72|1f3a33|fff)\b)[0-9a-fA-F]{3,8}\b/i);
  });
});
