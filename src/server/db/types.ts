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

export type IdentityDocumentTypeColumn = "CC" | "CE" | "PPT" | "PA";
export type ProviderRegistrationStatusColumn = "pending" | "approved" | "rejected";

export interface ProviderRegistrationsTable {
  id: Generated<string>;
  account_id: string;
  identity_document_type: IdentityDocumentTypeColumn;
  identity_number_encrypted: Buffer;
  identity_number_hash: Buffer;
  status: Generated<ProviderRegistrationStatusColumn>;
  created_at: DefaultedTimestamp;
  decided_at: Timestamp | null;
  decided_by_account_id: string | null;
  rejection_reason: string | null;
}

export interface RoleGrantsTable {
  id: Generated<string>;
  telegram_user_id: ColumnType<string, string | number | bigint, string | number | bigint>;
  role: "admin" | "provider";
  is_principal: boolean;
  provider_registration_id: string | null;
  granted_by_account_id: string | null;
  granted_at: DefaultedTimestamp;
  revoked_at: Timestamp | null;
  revoked_by_account_id: string | null;
}

export interface AuditEventsTable {
  id: Generated<string>;
  occurred_at: DefaultedTimestamp;
  actor_account_id: string | null;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: ColumnType<unknown, string | undefined, never>;
}

export interface NotificationOutboxTable {
  id: Generated<string>;
  recipient_telegram_user_id: ColumnType<string, string | number | bigint, string | number | bigint>;
  template: string;
  payload: ColumnType<unknown, string | undefined, never>;
  status: Generated<"pending" | "sent" | "failed">;
  attempts: Generated<number>;
  next_attempt_at: Timestamp | null;
  created_at: DefaultedTimestamp;
  sent_at: Timestamp | null;
}

export interface Database {
  privacy_notice_versions: PrivacyNoticeVersionsTable;
  accounts: AccountsTable;
  consent_events: ConsentEventsTable;
  processed_updates: ProcessedUpdatesTable;
  bot_sessions: BotSessionsTable;
  rate_limit_counters: RateLimitCountersTable;
  provider_registrations: ProviderRegistrationsTable;
  role_grants: RoleGrantsTable;
  audit_events: AuditEventsTable;
  notification_outbox: NotificationOutboxTable;
}
