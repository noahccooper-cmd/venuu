# venuu Push Notifications — Server Setup

## Prerequisites

- Supabase CLI installed (`brew install supabase/tap/supabase`)
- Supabase project linked (`supabase link --project-ref YOUR_PROJECT_REF`)
- Apple APNs .p8 key file downloaded from Apple Developer portal

APNs credentials (already configured in the Edge Functions):
- Team ID: `K67367A56J`
- Key ID: `YC67XHV6J5`
- Bundle ID: `com.venuu.app`

---

## 1. Set the APNS_KEY Secret

The .p8 file contents need to be stored as a Supabase secret. Open your `.p8` file and copy everything including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines.

```bash
supabase secrets set APNS_KEY="-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBH...your key here...
-----END PRIVATE KEY-----"
```

Verify the secret was set:

```bash
supabase secrets list
```

---

## 2. Deploy Edge Functions

Deploy all four functions:

```bash
supabase functions deploy send-push
supabase functions deploy push-drop
supabase functions deploy push-loyalty-reminder
supabase functions deploy push-broadcast
```

Or deploy all at once:

```bash
supabase functions deploy send-push push-drop push-loyalty-reminder push-broadcast
```

---

## 3. Set Up Database Webhook for Drop Notifications

When a new row is inserted into `venue_updates` (a Drop), trigger the `push-drop` function.

In the Supabase Dashboard:

1. Go to **Database > Webhooks**
2. Click **Create a new webhook**
3. Configure:
   - **Name:** `push-on-drop`
   - **Table:** `venue_updates`
   - **Events:** `INSERT`
   - **Type:** Supabase Edge Function
   - **Function:** `push-drop`
   - **HTTP Headers:** Add `Content-Type: application/json`
4. For the body, use a custom payload that maps the inserted row:

```sql
-- The webhook will send the inserted row as JSON.
-- The push-drop function expects: { venue_id, message, city }
-- You may need a database function to transform the payload:

CREATE OR REPLACE FUNCTION notify_drop()
RETURNS trigger AS $$
DECLARE
  venue_city text;
BEGIN
  SELECT city INTO venue_city FROM venues WHERE id = NEW.venue_id;

  PERFORM net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/push-drop',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := jsonb_build_object(
      'venue_id', NEW.venue_id,
      'message', NEW.message,
      'city', venue_city
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_drop_inserted
  AFTER INSERT ON venue_updates
  FOR EACH ROW
  EXECUTE FUNCTION notify_drop();
```

**Alternative (simpler):** Use the Supabase Dashboard webhook UI which automatically sends the row payload, then adjust the `push-drop` function to read from `record.venue_id`, `record.message`, etc.

---

## 4. Set Up Cron Schedule for Loyalty Reminders

The loyalty reminder runs every Friday at 5:00 PM (your local timezone).

In the Supabase Dashboard:

1. Go to **Database > Extensions** and enable `pg_cron` if not already enabled
2. Run this SQL:

```sql
SELECT cron.schedule(
  'loyalty-friday-reminder',
  '0 17 * * 5',  -- Every Friday at 5:00 PM (server timezone)
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/push-loyalty-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

To verify the cron job was created:

```sql
SELECT * FROM cron.job;
```

To remove it later:

```sql
SELECT cron.unschedule('loyalty-friday-reminder');
```

---

## 5. Manual Broadcast

Send a push notification to all users in a city:

```bash
curl -X POST \
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/push-broadcast' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Thursday night in Knoxville",
    "body": "See what'\''s happening tonight on venuu",
    "city": "Knoxville"
  }'
```

Send to ALL users (no city filter):

```bash
curl -X POST \
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/push-broadcast' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "New on venuu",
    "body": "Check out what venues are dropping tonight",
  }'
```

---

## 6. Test Push Notifications

Send a test notification to a single device token to verify the setup:

```bash
curl -X POST \
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-push' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "test": true,
    "token": "DEVICE_TOKEN_FROM_PUSH_TOKENS_TABLE"
  }'
```

Expected success response:

```json
{
  "test": true,
  "result": {
    "token": "...",
    "success": true,
    "status": 200
  }
}
```

---

## Troubleshooting

- **403 from APNs:** The .p8 key, Team ID, or Key ID is wrong. Double-check all three.
- **400 BadDeviceToken:** The device token is invalid or expired. Remove it from `push_tokens`.
- **410 Unregistered:** The app was uninstalled. Delete the token from `push_tokens`.
- **APNS_KEY secret not configured:** Run `supabase secrets set` again.
- **Function timeout:** If sending to many tokens, the function may timeout. Consider batching in groups of 500.

## Architecture

```
                 ┌─────────────┐
                 │  push-drop  │ ← DB webhook on venue_updates INSERT
                 └──────┬──────┘
                        │
┌──────────────────┐    │    ┌──────────────────────┐
│  push-broadcast  │────┼────│  push-loyalty-reminder│ ← Cron (Fri 5pm)
└──────────────────┘    │    └──────────────────────┘
        (manual)        │
                        ▼
                 ┌─────────────┐
                 │  send-push  │ → APNs (api.push.apple.com)
                 └─────────────┘
                   Core sender
```
