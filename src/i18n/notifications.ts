/**
 * Notifications are stored with an i18n key + params (Notification.key/params) and rendered in the
 * viewer's language. Rows created before i18n (no key) keep their stored English title/body.
 * Message shape: notify.<key>.title (required) and notify.<key>.body (optional).
 */
type Translator = { (key: string, values?: Record<string, string | number>): string; has(key: string): boolean };

export interface StoredNotification { key: string | null; params: unknown; title: string; body: string | null }

export function renderNotification(n: StoredNotification, t: Translator): { title: string; body: string | null } {
  if (!n.key || !t.has(`${n.key}.title`)) return { title: n.title, body: n.body };
  const p = (n.params && typeof n.params === "object" ? n.params : {}) as Record<string, string | number>;
  return { title: t(`${n.key}.title`, p), body: t.has(`${n.key}.body`) ? t(`${n.key}.body`, p) : n.body };
}
