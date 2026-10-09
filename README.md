# Homebase

A personal assistant for your phone, running on free services:

- **Reminders that learn.** Tell it "I clipped the cat's claws today." It picks a sensible interval from general knowledge, reminds you when it's due, and adapts to how often you actually do it.
- **What to wear.** Each morning it suggests an outfit from the hourly weather, your calendar, and how much of your day is indoors vs. outdoors: which layers, when to take them off, what to bring.
- **Chat.** Ask "what's due this week?", "what should I wear tomorrow, I'm hiking?", "add kid's dentist Oct 20 at 3pm".
- **Email watch (optional).** Emails from senders you choose (school, dentist, vet) are read by AI, and dates/to-dos show up for one-tap approval. Nothing outside the senders you choose is ever read.
- **Phone notifications** via the free ntfy app: a morning brief and an evening check-in.

```
 Android home screen
 ┌───────────────┐  HTTPS (token)  ┌─────────────────────┐   ┌───────────────┐
 │ Homebase PWA  │ ──────────────▶ │  Apps Script         │──▶│ Google Sheet  │ tasks, outfits, chat
 │ (GitHub Pages)│ ◀────────────── │  (runs as you)       │──▶│ Calendar/Gmail│
 └───────────────┘                 │                      │──▶│ Gemini API    │ free tier
        ▲                          │  daily triggers      │──▶│ Open-Meteo    │ weather, free
        │ push                     │                      │
   ntfy app ◀───────────────────── └─────────────────────┘
```

Folders:
- `backend/`: Apps Script files (`.gs`) and `appsscript.json`
- `pwa/`: the phone app (static files, no build step)

---

## How it stays free

Everything runs on free tiers: Apps Script, Google Sheets, GitHub Pages, Open-Meteo, ntfy, and the **Gemini API free tier**.

Gemini's free tier gives each model its own daily request limit. The cheaper **Flash-Lite** models get a large daily quota; the smarter **Flash** models get a small one (recently around 20 requests a day). So Homebase splits the work:

| Job | Model | Typical requests/day |
|---|---|---|
| Chat, logging tasks, AI intervals, email reading | **Flash-Lite** (everyday model) | 5–40 |
| Outfit advice | **Flash** (outfit model) | 1–3 |

- **Automatic model choice.** With the default `auto` setting, the backend asks Google which models your key can use and picks the newest Flash-Lite and Flash. When Google releases or retires models, it adjusts by itself.
- **Fallback.** If either model hits its limit or is overloaded, the request goes to the other one. If both are out, you get a clear message; reminders, tasks, calendar, and notifications keep working because they don't need AI.
- **Saving requests.** All new emails in an hourly scan go to the AI in one request (none if nothing is new). Opening the app never calls the AI by itself. The day's outfit is saved, so the morning brief and the app share it.
- **Your exact limits** are shown in Google AI Studio for your project. Settings → *AI models & today's usage* in the app shows how many requests Homebase sent today.

**Privacy tradeoff of the free tier:** Google uses free-tier prompts and responses to improve its products, and outside the EEA, Switzerland and the UK human reviewers may read them. That includes your chat, household notes, watched emails, and the clothing photos you ask AI to describe (each is sent once, when you add or re-describe an item; outfit advice sends only text). If that's a concern, leave email watching off, keep household notes general, or later attach billing to the same key (paid-tier data isn't used that way).

---

## Setup (about 20 minutes)

### 1. Get a free Gemini API key
1. Go to <https://aistudio.google.com> and sign in with your Google account.
2. Click **Get API key → Create API key**. No credit card is needed.
3. Copy the whole key. New keys start with `AQ.`; older ones start with `AIza`. Both work.

### 1b. Optional (recommended): use Claude instead
Claude is paid per use (roughly $1 a month for a family on Haiku 5.5), and Anthropic doesn't train on API data. With a Gemini key as well, Gemini takes over automatically if Claude ever fails.
1. Go to <https://console.anthropic.com>, sign in, and add a payment method under **Plans & Billing** (buy a small amount of credit, e.g. $5).
2. Under **Limits**, set a monthly spend limit (e.g. $5) so it can never surprise you.
3. **API Keys → Create Key**, and copy it (it starts with `sk-ant-`).
4. In step 2 below, add it as script property `CLAUDE_API_KEY`. Run `testClaude` in the editor to check it.
The models are set in Settings → *AI models, usage & cost* (default `claude-haiku-5-5` for everything); the same place shows this month's estimated cost.

### 2. Create the backend
1. Create a new Google Sheet named **Homebase**.
2. **Extensions → Apps Script**. Delete the default `Code.gs`.
3. For each file in `backend/`, click **+ → Script**, use the same name (without `.gs`), and paste the contents:
   `Config`, `Sheets`, `Tasks`, `AI`, `Outfit`, `Wardrobe`, `Calendar`, `Email`, `Notify`, `Api`.
4. **Project Settings (gear icon)**:
   - Tick **Show "appsscript.json" manifest file in editor**, then open `appsscript.json` in the editor and replace it with `backend/appsscript.json`. Change `"timeZone"` if you aren't on US Eastern time.
     This file also turns on the **Gmail API** service (you'll see it under *Services* in the left sidebar) and lists the exact permissions the project may use, including **read-only** Gmail and a narrow **Drive** permission (`drive.file`: only files Homebase itself creates, used for clothing photos).
   - Under **Script Properties**, add `GEMINI_API_KEY` = your key.
5. Back in the editor, choose the function **`setup`** and click **Run**. Approve the permissions: Sheets, Calendar, **View your email messages and settings** (read-only), connect to external services, and run when you're not present (triggers). Google will warn the app is unverified because you wrote it: **Advanced → Go to project**.
   Then choose **`authorizeDrive`** and click **Run** once, to approve the Drive permission and create the private photo folder.
6. Open **Execution log**. Copy the **APP TOKEN** and the **ntfy topic**, and check the line saying which Gemini models were picked. (Lost them? Run `showToken`. Want to test AI? Run `testGemini`.)
7. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (the app token is what protects it)
   - Copy the **Web app URL** (ends in `/exec`).

> When you change backend code later: **Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy**. The URL stays the same.

### 3. Host the app on GitHub Pages (free)
1. Create a new GitHub repository, e.g. `homebase`.
2. Upload all the files inside `pwa/` to the repository root (they're all loose files, no subfolders).
3. **Settings → Pages → Source: Deploy from a branch → main / root → Save**.
4. After a minute your app is at `https://<your-username>.github.io/homebase/`.

The repository can be public: it holds no secrets. Your token is typed into the app on your phone and stays there.

### 4. Install on your phone
1. Open the GitHub Pages address in **Chrome** on Android.
2. Paste the **Web app URL** and **App token**, then tap **Connect**.
3. Fill in Settings: tap **Use my location**, add a few lines under **Your clothes & style** (e.g. "I run cold, office is business casual, I have a rain shell and a puffer") and **About your household** (pets, kids, work days), then tap **Save settings**.
4. Chrome menu **⋮ → Add to Home screen → Install**.

### 5. Notifications

Choose in the app under **Settings → Notifications**.

**Telegram (recommended):** free and reliable.
1. In Telegram, message **@BotFather**, send `/newbot`, choose any name, and copy the **token** it gives you.
2. In Apps Script → **Project Settings → Script Properties**, add `TELEGRAM_BOT_TOKEN` = that token.
3. In Telegram, open your new bot and tap **Start**.
4. In Homebase: **Settings → Notifications → Telegram → Link Telegram**. You'll get a confirmation message in Telegram.

**ntfy (no account):** install **ntfy** from the Play Store, tap **+**, enter your topic from Settings (server: ntfy.sh), **Subscribe**. Caveat: ntfy's free server limits messages per IP address, and Apps Script sends from Google's shared IP addresses, so you may see "limit reached" even though you've sent very few. If that happens, switch to Telegram.

If the chosen channel fails and the other one is set up, Homebase sends through the other one automatically.

Test with **Settings → Send test notification**. If it arrives silently, enable sound for the app in Android **Settings → Notifications**.

---

## Using it

**Tasks**
- Easiest: just tell the chat (or the box on Today): *"I clipped the cat's claws today."* It matches an existing task or creates one with an AI-chosen interval and tells you when it will remind you.
- Or tap **+** on Tasks. **Let AI decide** picks the interval; **Every…** sets a fixed one; **One-time** is a to-do with a due date.
- After two or three completions, AI-chosen intervals switch to your actual rhythm (shown as *learned*). Fixed intervals never change.
- For kids' and pets' health, the doctor's or vet's schedule wins over AI defaults. Put real appointments on the calendar.

**Appointments**
Tell the chat ("Kid's dentist Oct 20 at 3pm") and it adds a Google Calendar event with reminders the day before and 2 hours before. Anything you add to Google Calendar directly also shows up on Today, in the morning brief, and in outfit advice.

**What to wear**
- The morning brief includes today's suggestion automatically, or tap **Suggest an outfit** with an optional note ("soccer game", "dinner out").
- It looks at the whole day hour by hour, not just the high: chilly mornings, afternoon showers, wind, UV. It also uses your calendar to tell indoor time (office, gym) from outdoor time (pickup, park, hike), plus your indoor temperature setting.
- You get a headline, the layers top to bottom with short reasons, what to bring, and when to add or remove layers.
- **Different idea** asks again; **Tomorrow** plans ahead (handy the night before).
- Tell it about yourself in Settings → *Your clothes & style*. The more specific ("I always wear sneakers", "no shorts at work"), the better.

**Wardrobe (with photos)**
- Open the **Wardrobe** tab and tap **+**. Take or choose a photo of one item. It's shrunk on your phone (about 30 KB) and saved in a private **Homebase wardrobe** folder in your Google Drive. AI looks at it and fills in the name, type, color, warmth (1 very light … 5 very warm), dress code and wears-before-wash. Check and save.
- **Pick yourself:** tap clothes to select them, then **Wear today**. **Let AI pick** builds an outfit from your *clean* clothes for today's weather and calendar, shows their photos, and logs them with **Wear this**. The same photos appear in the outfit card on Today, with an **I'm wearing this** button.
- **Laundry:** every item has a *wears before wash* number (tee 1, jeans 3, jacket 10, shoes 7 by default, editable). Each day an item is worn counts once. When the count reaches the limit, the item is greyed out with a *Laundry* badge and can't be picked or suggested. Tap **Mark washed** (one item, or the laundry bar for several) to bring it back. Retired items are also hidden from picks and suggestions.
- **Two wardrobes (or more):** Settings → *People & sizes*. You are always the first person; add your child with *Child*, a **current size** (for example "age 7") and notes. A name switcher appears on Wardrobe and Today. Each item has an owner and a **size** (for example "age 9" on a hand-me-down), and the Wardrobe has a size filter. AI picks use only that person's clean clothes, and for a child it also prefers pieces that fit the current size and are easy to wear. Existing items belong to you.
- **Add many photos:** **+ → Many photos at once**, choose the photos (one item each), pick who they belong to, and Start. Photos are shrunk and saved one by one while you keep using the app. Then AI describes them **one at a time**, about every 4 seconds, to stay within the free limit; if the limit is reached it stops and the rest wait under *need details* (tap **Describe with AI** tomorrow). **Stop** is always available.
- **Background:** each add form has a Background option. *Keep photo* is the default. *Cut out (AI)* removes the background on your phone with a free open-source model: the first use downloads about 80 MB and is then cached, and it works best on flat-lay photos. *Quick (plain background)* needs no download and works only on a plain, contrasting surface; if it can't do it, the original photo is kept. Nothing is uploaded for the cutout. The tool is AGPL-licensed, fine for personal use.
- **Collage:** select two or more items (or tap **Collage** on an outfit) to get a flat-lay picture: tops and jackets on the left, bottoms on the right, shoes and accessories along the bottom, with soft shadows. Photos on a plain background are cut out on the spot; others appear as neat cards. It's drawn on your phone with no AI. **Share / save** sends it to your gallery or any app. It looks best when your photos are cutouts.
- **Sharper photos:** new photos are stored at 800 px (older ones were 420 px; re-add or **Change photo** to upgrade them). The **↺ ↻** buttons in the item screen turn a photo, and *Turn every photo* does the same for a whole batch.
- **Cut out on your computer (best quality):** `tools/prepare_photos.py` straightens, cuts out the background with AI (rembg), crops and shrinks a whole folder to transparent PNGs. Then use **Many photos at once** and choose those PNGs; the app keeps their transparency as they are. Install once with `pip install pillow "rembg[cpu]" onnxruntime`, then run `python prepare_photos.py my_photos cutouts` (add `--rotate 90` to turn them, or `--quick` for plain backgrounds without AI).
- **Past looks (history the AI learns from):** every time you log two or more items as worn (**Wear today**, **I'm wearing this**, or by telling the chat), Homebase remembers the combination as that day's look. On a collage, **Save look** keeps a combination you like without wearing it. Wardrobe → **Past looks** lists them per person; tap one to see its collage, rate it 👍 or 👎, wear it again, or delete it. When the AI picks an outfit it is shown your recent looks and ratings, so it favours combinations like the ones you liked and avoids ones you didn't. Only item names and ratings are sent, never photos.
- **Tomorrow's outfits every night:** Settings → *Tomorrow's outfits for everyone* (9 pm by default; Off turns it off). Each night Homebase picks tomorrow's outfit for each person from their clean clothes and the forecast, and sends one summary notification. In the app, **Today → Tomorrow** shows each person's pick; tap **Collage** to see it laid out. The collage itself is drawn on the phone when you open it (Apps Script can't draw pictures), so the notification carries the text, not the picture. It costs one AI request per person per night.
- **Kids' privacy:** a clothing photo you add is sent once to Gemini (free tier terms) so it can be described. Photograph clothes laid flat, not worn.
- **Chat:** "I wore the grey fleece and jeans", "laundry is done", "I bought a green scarf", or "Mia needs a size 9 rain jacket" work too.

**Share to Homebase (TalkingPoints, websites, flyers)**
- Homebase appears in Android's **Share** menu once it's installed on your home screen (Chrome ⋮ → *Add to Home screen* / *Install app*; after this update remove the icon and add it again once so Android notices).
- Select text in any app or web page, or use an app's **Share** button, and pick **Homebase**. A link, a picture or a screenshot works too. The chat opens with what you shared above the message box and *"Find the dates, events and to-dos…"* ready; tap **Send**, or type your own question.
- In the chat you can also tap **📎** to add a photo or screenshot (a school flyer, a TalkingPoints message you can't copy).
- The assistant lists what it found (dates, times, places, deadlines, things to bring) and **asks before adding** anything to your calendar or tasks: reply "add all" or "just the first two".
- A shared link is read only if the page is public; pages behind a login can't be read, so share the selected text instead. Pictures are sent to Gemini once to be read and are not stored; the shared text is kept in the chat history so follow-ups work. Shared content is treated as data: instructions written inside it are ignored.

**Home: log anything in one line**
- The app opens on **Home**. Type (or tap 🎤 and say) what happened: "clipped the cat's claws", "Drey wore the blue hoodie and jeans", "dentist Oct 20 at 3", "laundry done". 📎 adds a photo or screenshot.
- If it was saved and the assistant has no question, a short confirmation appears right there (for about 8 seconds) with **Undo** (works for an hour for done tasks, new tasks, new events and worn clothes) and **Open in chat**. Questions, outfit requests and anything the assistant needs to ask about open the **Chat** tab. Everything is kept in your chat history either way.

**Tasks: only what's coming up**
- **Recurring** chores are folded together at the very end; one only appears at the top on the day it's due (or once it's overdue).
- Tasks shows what's overdue, due today and **tomorrow**. **Next 7 days** and **Next 14 days** are folded; tap to open. Anything further out isn't listed in the app (just counted); it's in the spreadsheet, and you can ask Homebase ("what's due next month?").
- You can add many tasks at once straight in the spreadsheet's **Tasks** tab: fill in `name`, and optionally `next_due` (e.g. 12/15/2026), `interval_days` with `last_done` for repeating ones, `notes`, `category`. Leave `id` blank; Homebase fills in the rest the next time it loads.

**Log: remember anything, look it up later**
- Tell Homebase anything worth remembering, on Home or in Chat: "Drey had a fever of 101 last night, gave Tylenol at 7", "oil change at 45,000 miles, $89", "Drey's height 128 cm at the checkup", "spare key is in the blue drawer". It's saved to the **Journal** tab of your spreadsheet (shared with the family unless you say "just for me"), and the Home confirmation has Undo.
- Ask about the past: "when was the last oil change?", "how many times did Drey have a fever this year?", "what did the vet say?". The assistant searches the Journal, finished tasks (with their notes), clothes worn, and your own earlier chat messages, and answers with dates.
- Everything is kept in the spreadsheet's **Journal** tab (not shown in the app). You can also type rows there; Homebase reads them too.
- **Every night (11:30 pm)** Homebase also reads that day's conversations and saves anything worth remembering that you didn't explicitly log (what the doctor said, a price, a decision), plus a one-line day summary. These automatic records are marked `auto` and are private to the person who had the conversation.

**Voice**
- Tap 🎤 (Home or Chat), speak, and the words appear in the box; check them and tap Send. It uses Chrome's speech recognition (audio goes to Google, like keyboard voice typing), so it works in Chrome, not inside WeChat's browser.
- When you used the mic, the reply is read aloud by the phone's voice; typed messages stay quiet. 🔊 on any reply reads it again.
- Settings → **Voice (this phone)**: the language you speak (English, 中文 普通话 / 台灣, 粵語, or the phone's language), the **reading voice**, and the **speed**, with a ▶ Test button. Voices marked “online” sound most natural; “Automatic” picks an online one when the phone has it. More voices: Android Settings → Text-to-speech → Google → install voice data. Each phone keeps its own choice. The assistant replies in the language you use.
- Settings sections are folded; tap a heading to open it. The app remembers which ones you left open.

**Family (shared Homebase with sign-in)**
- Settings → **Family** → **Invite someone**: give a name and pick their wardrobe (a new adult or child wardrobe, or an existing person). You get an **invite link**; send it privately. Opening it on their phone signs them in (then ⋮ → *Add to Home screen*).
- **Shared:** tasks (unless marked *Only me*), the wardrobe and outfits, email suggestions on Today, and the calendars you tick **Family** in Settings → Calendars. Events family members add go to the calendar chosen under *Events family members add go to* (e.g. Family), never to your own calendar.
- **Private:** each person's chat, and tasks marked **Only me** (in the task screen, or say "just for me" in chat). Only the person who added a task can make it private.
- **Only you:** your email (your chat can search all of it if you allow it; members never can), Settings for the household (location, calendars, email, AI, people), and the Family list.
- **Notifications:** everyone sets up their own in their Settings (their own ntfy topic, or Telegram: they open the family bot, tap Start, then *Link Telegram*). Morning brief, evening check-in and nightly outfits go to each person with their own tasks and calendars.
- **Opening Homebase from a notification:** Telegram always opens Telegram when you tap its notification (Android sends the tap to the app that posted it). Each message has a button (*Open Home*, *Open Tasks*, *See outfits*) that jumps straight to that tab. To make that button open the installed Homebase app instead of a browser page inside Telegram: in Telegram → Settings → Chat Settings, turn off the in-app browser. Homebase must be installed with Chrome's **Install app** (⋮ → Install app), not a plain home-screen shortcut. ntfy notifications open Homebase directly when tapped.
- **Pause / New link / Remove** in the Family list: pausing or a new link stops the old link at once; removing also deletes their chat and *Only me* tasks.
- Security: the invite code is stored only as a hash. Anyone with someone's link can act as them, so send links privately and make a new one if a phone is lost. Everything still runs under your Google account, so events and tasks they add are made by your account.

**Email watch**
In Settings → *Watch these emails*, tap the row to expand the list, then add one sender (an address like `office@school.org` or a whole domain like `school.org`) per row; tap ✕ to remove one. The list is collapsed by default and shows how many senders are watched. Every hour, new matching emails are read and anything with a date or action appears on Today as a suggestion. Nothing is added to your calendar or tasks until you tap.

This list is also the **only** email the chat can see. Ask "anything from the school this week?" and the search runs as *(your watched senders) AND (your question)*; emails outside it can't be found or opened from chat. Leave the list empty to turn all email reading off.

---

## Notes and limits

- **Data.** The Sheet and code live in your Google account. Text sent to Gemini (chat, household and clothes notes, weather/calendar for outfit advice, watched emails) is covered by the free-tier terms above. Only emails matching your watch query are read, whether by the hourly check or by chat.
- **Gmail is read-only, enforced by Google.** The project is granted only the `gmail.readonly` permission, so it cannot send, delete, label or change email; Google blocks it even if the code were edited. Read access technically covers your mailbox, and Homebase's code then limits reading to your watch query. You can review or remove access at myaccount.google.com → Security → Your connections to third-party apps & services.
- **Security.** The web app is reachable by anyone with its URL *and* the token. If you think the token leaked, delete the `APP_TOKEN` script property, run `setup` again, and paste the new token in the app.
- **Speed.**
  - *Tabs open instantly:* the app keeps a copy of everything on your phone and shows it at once; one background request refreshes all tabs together (at most once a minute, or when you come back to the app). The app's own files also load from the phone, and a new version is picked up the next time you open it.
  - *Outfits are usually ready before you ask:* each night (9 pm by default) Homebase prepares tomorrow's pick **and a spare "different idea"** for every person; the morning brief fills in anything missing. Opening Today, tapping **Tomorrow**, or **Different idea** then shows them instantly. This uses 2 AI requests per person per night (on the smarter model, since nobody is waiting).
  - *Asking for a new pick:* a **quick pick** appears immediately, made on your phone from your clean clothes (warmth for the coolest part of the day, rain gear when wet, dress code from the calendar, skips what you wore lately, favours pieces from looks you liked). The AI version replaces it a few seconds later; by default it uses the smarter model with your full wardrobe (about 15–40 seconds; Settings → *AI models* → *Outfit picks you ask for* can switch to Fast, about 4–10 seconds), and if it fails the quick pick stays. A special request typed in the box (e.g. "dinner out") goes straight to the AI. Chat answers "what should I wear" from the prepared pick when there is one.
  - The first request after a quiet period is slower while Google wakes the script, but you won't wait for it: the saved copy is already on screen.
- **Choosing models yourself.** In Settings → *AI models & today's usage*, replace `auto` with an exact model name from AI Studio. Set it back to `auto` to return to automatic choice.
- **Triggers.** Morning brief and evening check-in times come from Settings; changing them there reinstalls the triggers. Email scanning runs hourly.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Unauthorized" | Token in app doesn't match. Run `showToken` and paste again. |
| "Unexpected reply from backend" | Wrong URL (must end in `/exec`), or deployment access isn't **Anyone**. |
| Changes to backend code don't apply | Deploy a **new version** of the web app. |
| "Missing GEMINI_API_KEY" | Add the script property, exactly that name. Then run `testGemini`. |
| "Daily free AI limit reached" | Wait until tomorrow; non-AI features keep working. Check limits in AI Studio. |
| "Gmail is not defined" | In the Apps Script editor, **Services → + → Gmail API → Add** (or re-paste `appsscript.json`). |
| Gemini 404 / model not found | A model was retired. With `auto`, it re-picks on the next request; with a fixed name, change it in Settings. |
| Weather says location not set | Settings → Use my location → Save settings. |
| No notifications | Check the ntfy topic matches, then use Send test notification. Allow ntfy to run in background (Android battery settings). |
| "Drive permission missing" | Re-paste `appsscript.json`, run `authorizeDrive` in the editor, approve, then Deploy → New version. |
| Errors in general | Apps Script → **Executions** shows each run and its error. |
