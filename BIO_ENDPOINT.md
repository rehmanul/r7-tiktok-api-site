# TikTok Bio API Endpoint

## 📍 Endpoint: `/api/bio`

Get TikTok user profile information including bio, follower counts, and avatar.

---

## 🚀 Usage

### Request
```bash
GET /api/bio?username=charlidamelio
```

### Parameters
- `username` (required) - TikTok username (with or without @)

### Optional Headers
- `X-TikTok-Cookie` - TikTok session cookies for authenticated access

---

## 📤 Response

### Success (200 OK)
```json
{
  "status": "success",
  "data": {
    "username": "charlidamelio",
    "nickname": "charli d'amelio",
    "bio": "i love my job 🤍\nvenmo: @charlidamelio-donations",
    "verified": true,
    "followerCount": 155000000,
    "followingCount": 1543,
    "videoCount": 2456,
    "heartCount": 9800000000,
    "avatarUrl": "https://p16-sign-va.tiktokcdn.com/...",
    "profileUrl": "https://www.tiktok.com/@charlidamelio"
  }
}
```

### Error (404 Not Found)
```json
{
  "error": "TikTok profile \"invaliduser\" not found",
  "status": "error",
  "code": 404
}
```

### Error (400 Bad Request)
```json
{
  "error": "Missing required parameter: username",
  "status": "error",
  "code": 400
}
```

---

## 🎯 Examples

### cURL
```bash
# Basic request
curl "https://your-domain.vercel.app/api/bio?username=charlidamelio"

# With @ symbol (automatically stripped)
curl "https://your-domain.vercel.app/api/bio?username=@charlidamelio"

# With TikTok cookies
curl -H "X-TikTok-Cookie: sessionid=xxx; tt_csrf_token=yyy" \
  "https://your-domain.vercel.app/api/bio?username=charlidamelio"
```

### JavaScript (Fetch)
```javascript
async function getTikTokBio(username) {
  const response = await fetch(`https://your-domain.vercel.app/api/bio?username=${username}`);
  const data = await response.json();
  
  if (data.status === 'success') {
    console.log('Bio:', data.data.bio);
    console.log('Followers:', data.data.followerCount);
  } else {
    console.error('Error:', data.error);
  }
}

getTikTokBio('charlidamelio');
```

### Python
```python
import requests

def get_tiktok_bio(username):
    response = requests.get(f'https://your-domain.vercel.app/api/bio?username={username}')
    data = response.json()
    
    if data['status'] == 'success':
        print(f"Bio: {data['data']['bio']}")
        print(f"Followers: {data['data']['followerCount']}")
    else:
        print(f"Error: {data['error']}")

get_tiktok_bio('charlidamelio')
```

---

## ⚡ Performance

### Speed
- **Cold start:** 1-3 seconds (first request)
- **Cached:** <100ms (5-minute cache)
- **Much faster than `/api/tiktok`** (no browser, just HTTP)

### Caching
- **Edge cache:** 5 minutes (`s-maxage=300`)
- **Stale-while-revalidate:** 10 minutes
- **In-memory cache:** 5 minutes (per serverless instance)

### Resource Usage
- **CPU:** Very low (simple HTTP request, no Chromium)
- **Memory:** Minimal (<50 MB)
- **Bandwidth:** Low (only HTML page, no media)

---

## 🔍 Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `username` | string | TikTok username (unique ID) |
| `nickname` | string | Display name |
| `bio` | string | Profile bio/description |
| `verified` | boolean | Whether account is verified |
| `followerCount` | number | Number of followers |
| `followingCount` | number | Number of accounts following |
| `videoCount` | number | Total videos posted |
| `heartCount` | number | Total likes received |
| `avatarUrl` | string | Profile picture URL (high resolution) |
| `profileUrl` | string | Direct link to TikTok profile |

---

## 🛡️ Error Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad request (missing/invalid username) |
| 404 | Profile not found |
| 405 | Method not allowed (only GET supported) |
| 504 | Request timeout |
| 500 | Server error |

---

## 💡 Use Cases

### 1. Profile Preview
Display user bio and stats before showing videos:
```javascript
const bio = await fetch(`/api/bio?username=${username}`);
const bioData = await bio.json();

// Show bio, followers, avatar
document.getElementById('bio').textContent = bioData.data.bio;
document.getElementById('followers').textContent = bioData.data.followerCount;
```

### 2. Batch Profile Analysis
Quickly fetch bios for multiple users:
```javascript
const usernames = ['charlidamelio', 'khaby.lame', 'bellapoarch'];
const bios = await Promise.all(
  usernames.map(u => fetch(`/api/bio?username=${u}`).then(r => r.json()))
);
```

### 3. Verification Check
Check if an account is verified:
```javascript
const { data } = await fetch(`/api/bio?username=${username}`).then(r => r.json());
if (data.verified) {
  console.log('✓ Verified account');
}
```

---

## 🔄 Comparison with `/api/tiktok`

| Feature | `/api/bio` | `/api/tiktok` |
|---------|-----------|---------------|
| **Data returned** | Profile info only | Videos + profile |
| **Speed** | 1-3s (cold) | 5-10s (cold) |
| **CPU usage** | Very low | High (Chromium) |
| **Browser required** | No | Yes |
| **Lightweight** | ✅ | ❌ |
| **Best for** | Profile info | Video data |

---

## 🚀 Benefits

✅ **Fast:** 5-10x faster than video endpoint  
✅ **Lightweight:** No browser, minimal CPU  
✅ **Cached:** Edge caching for instant responses  
✅ **Simple:** One HTTP request to TikTok  
✅ **Reliable:** Less likely to be rate limited  
✅ **Cost-effective:** Minimal function execution time  

---

## 📝 Notes

- Bio data updates every 5 minutes (cache TTL)
- Supports same cookie authentication as `/api/tiktok`
- Automatically strips @ from usernames
- Username validation: alphanumeric, dots, dashes, underscores only
- CORS enabled for all origins

---

## ✅ Ready to Use

The endpoint is live at:
```
https://your-domain.vercel.app/api/bio?username=<username>
```

Test it now! 🎉

