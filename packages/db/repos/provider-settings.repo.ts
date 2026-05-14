import type { MegumiDatabase } from '../connection';
import {
  DEFAULT_PROVIDER_SETTINGS,
  isProviderId,
  type ProviderId,
  type ProviderSettings,
  type SecretRef,
} from '@megumi/shared/provider-contracts';

interface ProviderSettingsRow {
  id: string;
  provider_id: string;
  kind: ProviderSettings['kind'];
  display_name: string;
  enabled: 0 | 1;
  base_url: string | null;
  default_model_id: string;
  secret_ref_id: string | null;
  secret_ref_provider_id: string | null;
  secret_ref_scope: SecretRef['scope'] | null;
  created_at: string;
  updated_at: string;
}

export type ProviderSettingsUpdate = Partial<
  Pick<ProviderSettings, 'displayName' | 'enabled' | 'baseUrl' | 'defaultModelId' | 'secretRef'>
>;

export class ProviderSettingsRepository {
  constructor(
    private readonly database: MegumiDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  initializeDefaults(defaults: Record<ProviderId, ProviderSettings> = DEFAULT_PROVIDER_SETTINGS): void {
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO provider_settings (
        id,
        provider_id,
        kind,
        display_name,
        enabled,
        base_url,
        default_model_id,
        secret_ref_id,
        secret_ref_provider_id,
        secret_ref_scope,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @provider_id,
        @kind,
        @display_name,
        @enabled,
        @base_url,
        @default_model_id,
        @secret_ref_id,
        @secret_ref_provider_id,
        @secret_ref_scope,
        @created_at,
        @updated_at
      )
    `);

    const timestamp = this.now();

    const transaction = this.database.transaction((settingsList: ProviderSettings[]) => {
      for (const settings of settingsList) {
        insert.run(this.toRow({
          ...settings,
          createdAt: timestamp,
          updatedAt: timestamp,
        }));
      }
    });

    transaction(Object.values(defaults));
  }

  list(): ProviderSettings[] {
    const rows = this.database
      .prepare('SELECT * FROM provider_settings ORDER BY provider_id ASC')
      .all() as ProviderSettingsRow[];

    const providerOrder: Record<ProviderId, number> = {
      deepseek: 0,
      openai: 1,
      anthropic: 2,
    };

    return rows
      .map((row) => this.fromRow(row))
      .filter((settings): settings is ProviderSettings => settings !== undefined)
      .sort((left, right) => providerOrder[left.providerId] - providerOrder[right.providerId]);
  }

  get(providerId: ProviderId): ProviderSettings | undefined {
    const row = this.database
      .prepare('SELECT * FROM provider_settings WHERE provider_id = ?')
      .get(providerId) as ProviderSettingsRow | undefined;

    return row ? this.fromRow(row) : undefined;
  }

  upsert(settings: ProviderSettings): ProviderSettings {
    this.database
      .prepare(`
        INSERT INTO provider_settings (
          id,
          provider_id,
          kind,
          display_name,
          enabled,
          base_url,
          default_model_id,
          secret_ref_id,
          secret_ref_provider_id,
          secret_ref_scope,
          created_at,
          updated_at
        ) VALUES (
          @id,
          @provider_id,
          @kind,
          @display_name,
          @enabled,
          @base_url,
          @default_model_id,
          @secret_ref_id,
          @secret_ref_provider_id,
          @secret_ref_scope,
          @created_at,
          @updated_at
        )
        ON CONFLICT(provider_id) DO UPDATE SET
          id = excluded.id,
          kind = excluded.kind,
          display_name = excluded.display_name,
          enabled = excluded.enabled,
          base_url = excluded.base_url,
          default_model_id = excluded.default_model_id,
          secret_ref_id = excluded.secret_ref_id,
          secret_ref_provider_id = excluded.secret_ref_provider_id,
          secret_ref_scope = excluded.secret_ref_scope,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `)
      .run(this.toRow(settings));

    const saved = this.get(settings.providerId);

    if (!saved) {
      throw new Error(`Provider settings were not saved for ${settings.providerId}`);
    }

    return saved;
  }

  updateProvider(providerId: ProviderId, update: ProviderSettingsUpdate): ProviderSettings {
    const existing = this.get(providerId) ?? {
      ...DEFAULT_PROVIDER_SETTINGS[providerId],
      createdAt: this.now(),
      updatedAt: this.now(),
    };

    const next: ProviderSettings = {
      ...existing,
      ...update,
      updatedAt: this.now(),
    };

    return this.upsert(next);
  }

  private toRow(settings: ProviderSettings): ProviderSettingsRow {
    return {
      id: settings.id,
      provider_id: settings.providerId,
      kind: settings.kind,
      display_name: settings.displayName,
      enabled: settings.enabled ? 1 : 0,
      base_url: settings.baseUrl ?? null,
      default_model_id: settings.defaultModelId,
      secret_ref_id: settings.secretRef?.id ?? null,
      secret_ref_provider_id: settings.secretRef?.providerId ?? null,
      secret_ref_scope: settings.secretRef?.scope ?? null,
      created_at: settings.createdAt,
      updated_at: settings.updatedAt,
    };
  }

  private fromRow(row: ProviderSettingsRow): ProviderSettings | undefined {
    if (!isProviderId(row.provider_id)) {
      return undefined;
    }

    const secretRef = this.toSecretRef(row);

    return {
      id: row.id,
      providerId: row.provider_id,
      kind: row.kind,
      displayName: row.display_name,
      enabled: row.enabled === 1,
      ...(row.base_url ? { baseUrl: row.base_url } : {}),
      defaultModelId: row.default_model_id,
      ...(secretRef ? { secretRef } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toSecretRef(row: ProviderSettingsRow): SecretRef | undefined {
    if (!row.secret_ref_id || !row.secret_ref_provider_id || !row.secret_ref_scope) {
      return undefined;
    }

    if (!isProviderId(row.secret_ref_provider_id)) {
      return undefined;
    }

    return {
      id: row.secret_ref_id,
      providerId: row.secret_ref_provider_id,
      scope: row.secret_ref_scope,
    };
  }
}
