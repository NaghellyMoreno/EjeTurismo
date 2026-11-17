import { buildNoticeMessages } from "@/lib/notice";
import type { components } from "@/shared/api/schema";

type PrivacyNotice = components["schemas"]["PrivacyNotice"];

// M01: el mismo aviso y la misma declaración que el bot, como texto plano (F036, P1). Se usa la misma función que arma los
// 3 mensajes del bot y se unen con una línea en blanco; si el aviso no tiene los apartados esperados, devuelve nulo.
export function noticeText(notice: PrivacyNotice): string | null {
  try {
    return buildNoticeMessages({
      bodyMarkdown: notice.bodyMarkdown,
      declarationText: notice.declarationText,
      publishedAt: new Date(notice.publishedAt),
    }).join("\n\n");
  } catch {
    return null;
  }
}
