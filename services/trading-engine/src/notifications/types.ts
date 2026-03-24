/**
 * Notification Domain Types — Phase 5
 */

export type NotificationCategory = 'trading' | 'safety' | 'billing' | 'referrals' | 'system';

export type DeliveryChannel = 'in_app' | 'email' | 'telegram' | 'push';

export interface Notification {
  id: string;
  user_id: string;
  category: NotificationCategory;
  event_type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  delivery_channel: DeliveryChannel;
  delivered_at: string | null;
  idempotency_key: string | null;
  created_at: string;
}

export interface NotificationPreferences {
  id: string;
  user_id: string;
  trading_enabled: boolean;
  safety_enabled: boolean;
  billing_enabled: boolean;
  referrals_enabled: boolean;
  system_enabled: boolean;
  muted_event_types: string[];
  email_enabled: boolean;
  telegram_enabled: boolean;
  push_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateNotificationInput {
  userId: string;
  category: NotificationCategory;
  eventType: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}

// Default preferences for new users
export const DEFAULT_PREFERENCES: Omit<NotificationPreferences, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  trading_enabled: true,
  safety_enabled: true,
  billing_enabled: true,
  referrals_enabled: true,
  system_enabled: true,
  muted_event_types: [],
  email_enabled: false,
  telegram_enabled: false,
  push_enabled: false,
};
