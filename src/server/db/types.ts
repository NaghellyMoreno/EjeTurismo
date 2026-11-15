import type { ColumnType, Generated } from "kysely";

// Tipos del esquema `app`, escritos a mano mientras no se genere con kysely-codegen (ADR 0013). pg devuelve bigint como texto.
type Timestamp = ColumnType<Date, Date | string, Date | string>;
type DefaultedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Channel = "bot" | "mini_app";

export interface PrivacyNoticeVersionsTable {
  version: string;
  body_markdown: string;
  declaration_text: string;
  revocation_note: string | null;
  published_at: DefaultedTimestamp;
  is_current: boolean;
}

export interface AccountsTable {
  id: Generated<string>;
  telegram_user_id: ColumnType<string, string | number | bigint, string | number | bigint>;
  telegram_display_name: string | null;
  consent_notice_version: string;
  consent_accepted_at: Timestamp;
  consent_channel: Channel;
  created_at: DefaultedTimestamp;
}

export interface ConsentEventsTable {
  id: Generated<string>;
  event: "accepted" | "revoked";
  channel: Channel;
  notice_version: string;
  occurred_at: DefaultedTimestamp;
}

export interface ProcessedUpdatesTable {
  update_id: ColumnType<string, string | number | bigint, never>;
  received_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface BotSessionsTable {
  account_id: string;
  data: unknown;
  updated_at: DefaultedTimestamp;
}

export interface RateLimitCountersTable {
  account_id: string;
  action: string;
  window_start: Timestamp;
  count: number;
}

export interface Database {
  privacy_notice_versions: PrivacyNoticeVersionsTable;
  accounts: AccountsTable;
  consent_events: ConsentEventsTable;
  processed_updates: ProcessedUpdatesTable;
  bot_sessions: BotSessionsTable;
  rate_limit_counters: RateLimitCountersTable;
}
