# API Keys Management

## 📄 File: `api-keys.json`

This file stores all valid API keys for accessing the TikTok API endpoints.

---

## 🔑 Current API Keys

- `admin` - Admin Key
- `darkcampaign` - Dark Campaign Key

---

## ➕ Adding a New API Key

Edit `api-keys.json` and add a new entry to the `keys` array:

```json
{
  "keys": [
    {
      "key": "admin",
      "name": "Admin Key",
      "enabled": true,
      "createdAt": "2025-01-23T00:00:00.000Z"
    },
    {
      "key": "darkcampaign",
      "name": "Dark Campaign Key",
      "enabled": true,
      "createdAt": "2025-01-23T00:00:00.000Z"
    },
    {
      "key": "your-new-key-here",
      "name": "Description of this key",
      "enabled": true,
      "createdAt": "2025-01-23T00:00:00.000Z"
    }
  ]
}
```

### Fields:
- **`key`** (required): The actual API key string that users will use
- **`name`** (optional): Human-readable description of the key
- **`enabled`** (required): Set to `true` to allow, `false` to disable
- **`createdAt`** (optional): Timestamp when the key was created

---

## 🚫 Disabling an API Key

To disable a key without deleting it, set `enabled` to `false`:

```json
{
  "key": "old-key",
  "name": "Old Key",
  "enabled": false,
  "createdAt": "2025-01-20T00:00:00.000Z"
}
```

---

## 🗑️ Removing an API Key

Simply delete the entire key object from the `keys` array:

```json
{
  "keys": [
    {
      "key": "admin",
      "name": "Admin Key",
      "enabled": true,
      "createdAt": "2025-01-23T00:00:00.000Z"
    }
    // Removed darkcampaign key
  ]
}
```

---

## 🔄 How It Works

1. **File is cached for 1 minute** - Changes take up to 60 seconds to apply
2. **Automatic fallback** - If file can't be read, defaults to `admin` and `darkcampaign`
3. **Validation on every request** - API key is checked before processing

---

## 📋 Usage Examples

### Valid Request:
```bash
curl "https://your-domain.vercel.app/api/tiktok?username=charlidamelio&apiKey=admin"
```

### Invalid Request (no API key):
```bash
curl "https://your-domain.vercel.app/api/tiktok?username=charlidamelio"
```
Returns:
```json
{
  "error": "Unauthorized",
  "message": "Missing API key",
  "status": "error",
  "code": 401,
  "hint": "Include a valid API key in the query string: ?apiKey=YOUR_KEY"
}
```

### Invalid Request (wrong API key):
```bash
curl "https://your-domain.vercel.app/api/tiktok?username=charlidamelio&apiKey=wrong"
```
Returns:
```json
{
  "error": "Unauthorized",
  "message": "Invalid API key",
  "status": "error",
  "code": 401
}
```

---

## 🔒 Security Best Practices

1. **Don't commit sensitive keys** - Add truly secret keys via Vercel environment variables instead
2. **Use descriptive names** - Know who each key belongs to
3. **Rotate keys periodically** - Disable old keys and create new ones
4. **Monitor usage** - Check Vercel logs for suspicious activity
5. **Unique keys per user** - Give each user/application their own key

---

## 🚀 Deploying Changes

After editing `api-keys.json`:

```bash
git add api-keys.json
git commit -m "Update API keys"
git push origin main
```

Vercel will automatically redeploy. Changes take effect within 1 minute due to caching.

---

## 📊 Which Endpoints Require API Keys?

| Endpoint | API Key Required? |
|----------|-------------------|
| `/api/tiktok` | ✅ Yes |
| `/api/bio` | ✅ Yes |
| `/api/docs` | ❌ No (public documentation) |

---

## 💡 Tips

- Keep the `admin` key for testing
- Create separate keys for different clients/applications
- Use meaningful names to track key usage
- Set `enabled: false` instead of deleting to preserve history
- Check Vercel function logs to see which keys are being used

---

## 🆘 Troubleshooting

### Keys not working after update?
- Wait 60 seconds for cache to expire
- Check JSON syntax is valid (use a JSON validator)
- Ensure `enabled: true` is set
- Check Vercel deployment logs for errors

### Need to invalidate cache immediately?
- Restart the Vercel deployment
- Or change the key value and update client requests

---

## 📖 Example: Multiple Keys for Different Clients

```json
{
  "keys": [
    {
      "key": "admin",
      "name": "Admin/Testing Key",
      "enabled": true,
      "createdAt": "2025-01-23T00:00:00.000Z"
    },
    {
      "key": "darkcampaign",
      "name": "Dark Campaign Application",
      "enabled": true,
      "createdAt": "2025-01-23T00:00:00.000Z"
    },
    {
      "key": "mobile-app-v1",
      "name": "Mobile App Production",
      "enabled": true,
      "createdAt": "2025-01-23T00:00:00.000Z"
    },
    {
      "key": "web-dashboard-prod",
      "name": "Web Dashboard",
      "enabled": true,
      "createdAt": "2025-01-23T00:00:00.000Z"
    },
    {
      "key": "partner-xyz",
      "name": "Partner XYZ Integration",
      "enabled": false,
      "createdAt": "2025-01-20T00:00:00.000Z",
      "note": "Disabled temporarily"
    }
  ]
}
```

This makes it easy to:
- Track which application is making requests
- Disable specific integrations without affecting others
- Manage access per client

