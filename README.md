# Homebase

A personal assistant for your phone, running on free services:

- **Reminders that learn.** Tell it "I clipped the cat's claws today." It picks a sensible interval from general knowledge, reminds you when it's due, and adapts to how often you actually do it.
- **What to bring.** Each morning (and on Home) it says what to take from the hourly weather: a jacket, an umbrella, sunglasses, allergy medicine in your allergy months.
- **Food log and "what should I eat?".** Snap your meals (and a receipt); AI fills in the dish, ingredients, homemade or restaurant, and rough calories. When you can't decide, it asks a few quick questions and suggests three ideas from your habits.
- **Chat.** Ask "what's due this week?", "what should I eat tonight?", "add kid's dentist Oct 20 at 3pm".
- **Email watch (optional).** Emails from senders you choose (school, dentist, vet) are read by AI, and dates/to-dos show up for one-tap approval. Nothing outside the senders you choose is ever read.
- **Phone notifications** via the free ntfy app: a morning brief and an evening check-in.

```
 Android home screen
 ┌───────────────┐  HTTPS (token)  ┌─────────────────────┐   ┌───────────────┐
 │ Homebase PWA  │ ──────────────▶ │  Apps Script         │──▶│ Google Sheet  │ tasks, meals, chat
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

> **With a Claude key (your setup), everything below runs on Claude Haiku 5.5**: chat, reading meal photos and receipts, food ideas, email. Gemini is only used if you also keep a `GEMINI_API_KEY`, and then only as a backup when a Claude request fails (for example, out of credit). Remove that key, or set Settings → AI models → *AI provider* to Claude, to never use Gemini. The table is for the free Gemini-only setup.

| Job | Model | Typical requests/day |
|---|---|---|
| Chat, logging tasks, AI intervals, email reading | **Flash-Lite** (everyday model) | 5–40 |
| "What should I eat?" ideas | **Flash** (food ideas model) | 1–5 |

- **Automatic model choice.** With the default `auto` setting, the backend asks Google which models your key can use and picks the newest Flash-Lite and Flash. When Google releases or retires models, it adjusts by itself.
- **Fallback.** If either model hits its limit or is overloaded, the request goes to the other one. If both are out, you get a clear message; reminders, tasks, calendar, and notifications keep working because they don't need AI.
- **Saving requests.** All new emails in an hourly scan go to the AI in one request (none if nothing is new). Opening the app calls the AI only for Bella's short note for the day (once a day per person, again only if your plans or the weather change). The list of what to bring is worked out from the forecast without AI.
- **Your exact limits** are shown in Google AI Studio for your project. Settings → *AI models & today's usage* in the app shows how many requests Homebase sent today.

**Privacy tradeoff of the free tier:** Google uses free-tier prompts and responses to improve its products, and outside the EEA, Switzerland and the UK human reviewers may read them. That includes your chat, household notes, watched emails, and the meal photos and receipts you ask AI to read (each is sent once, when you tap *Read it*). With a Claude key, Anthropic doesn't use API data for training. If that's a concern, leave email watching off, keep household notes general, or later attach billing to the same key (paid-tier data isn't used that way).

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
   `Config`, `Sheets`, `Tasks`, `AI`, `Weather`, `People`, `Food`, `Taste`, `Calendar`, `Email`, `Notify`, `Api`, `Charts`, `GrowthData`.
4. **Project Settings (gear icon)**:
   - Tick **Show "appsscript.json" manifest file in editor**, then open `appsscript.json` in the editor and replace it with `backend/appsscript.json`. Change `"timeZone"` if you aren't on US Eastern time.
     This file also turns on the **Gmail API** service (you'll see it under *Services* in the left sidebar) and lists the exact permissions the project may use, including **read-only** Gmail and a narrow **Drive** permission (`drive.file`: only files Homebase itself creates, used for meal photos and receipts).
   - Under **Script Properties**, add `GEMINI_API_KEY` = your key.
5. Back in the editor, choose the function **`setup`** and click **Run**. Approve the permissions: Sheets, Calendar, **View your email messages and settings** (read-only), connect to external services, and run when you're not present (triggers). Google will warn the app is unverified because you wrote it: **Advanced → Go to project**.
   Then choose **`authorizeDrive`** and click **Run** once, to approve the Drive permission and create the private photo folder.
6. Open **Execution log**. Copy the **APP TOKEN** and the **ntfy topic**, and check the line saying which Gemini models were picked. (Lost them? Run `showToken`. Want to test AI? Run `testGemini`.)
7. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (the app token is what protects it)
   - Copy the **Web app URL** (ends in `/exec`).

> When you change backend code later: **Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy**. The URL stays the same.

> **Upgrading from the wardrobe version:** in Apps Script, delete the `Outfit` and `Wardrobe` scripts and add `Weather`, `People` and `Food`. The old **Wardrobe, Outfits, Worn and Looks** tabs are no longer used; delete them from the spreadsheet whenever you like. Meal photos go into your existing photo folder in Drive (you can rename "Homebase wardrobe" to anything; Homebase finds it by id) and you can delete the clothing photos in it. The nightly outfit trigger is removed the first time you save Settings.

### 3. Host the app on GitHub Pages (free)
1. Create a new GitHub repository, e.g. `homebase`.
2. Upload all the files inside `pwa/` to the repository root (they're all loose files, no subfolders).
3. **Settings → Pages → Source: Deploy from a branch → main / root → Save**.
4. After a minute your app is at `https://<your-username>.github.io/homebase/`.

The repository can be public: it holds no secrets. Your token is typed into the app on your phone and stays there.

### 4. Install on your phone
1. Open the GitHub Pages address in **Chrome** on Android.
2. Paste the **Web app URL** and **App token**, then tap **Connect**.
3. Fill in Settings: tap **Use my location**, pick your allergy months under **Weather** if you want that reminder, add food notes under **People** (allergies, dislikes, goals), and **About your household** (pets, kids, work days), then tap **Save settings**.
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

### 6. Optional: Bella's natural voice (Google Cloud Chirp)

Without this, Bella reads with the phone's own voice. With it, she uses Google's natural "Chirp 3: HD" voices. **The first 1 million characters each month are free** (a spoken reply is about 150–250 characters, so roughly 4,000+ replies). Homebase counts what it uses and switches to the phone voice at 900,000, so it stays inside the free amount. Google asks for a billing account (a card) even for the free part.

1. Go to **console.cloud.google.com**, pick or create a project, and turn on **Billing** for it (Billing → Link a billing account).
2. **APIs & Services → Library**, search **Cloud Text-to-Speech API**, tap **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**. Copy it. (Optional but good: *Edit API key → API restrictions → Restrict key → Cloud Text-to-Speech API*.)
4. Safety net: **Billing → Budgets & alerts → Create budget**, amount **$1**, so Google emails you if anything is ever charged.
5. In Apps Script → **Project Settings → Script Properties**, add `TTS_API_KEY` = that key.
6. Run **`testVoice`** in the editor. It should say "Natural voice works".

The voice is chosen per phone in **Settings → Voice (this phone) → Bella's voice** (Aoede is the default; ▶ Test plays a sample). The usage line there shows how much of this month's free amount is used. To change the free-amount guard, add the setting `voice_monthly_cap` in the Settings tab of the Sheet (a number of characters; 1,000,000 is the free limit).

---

## Using it

**Tasks**
- Easiest: just tell the chat (or the box on Today): *"I clipped the cat's claws today."* It matches an existing task or creates one with an AI-chosen interval and tells you when it will remind you.
- Or tap **+** on Tasks. **Let AI decide** picks the interval; **Every…** sets a fixed one; **One-time** is a to-do with a due date.
- After two or three completions, AI-chosen intervals switch to your actual rhythm (shown as *learned*). Fixed intervals never change.
- For kids' and pets' health, the doctor's or vet's schedule wins over AI defaults.
- **Timed reminders:** any task can have its own reminder time. Say it to the chat ("remind me at 2pm to call the school", "dentist Friday 3pm, remind me 2 hours before", "remind me the night before at 8") or set **Reminder** in the task form (a time, and *same day / day before / 2 days before / week before*). At that time you get a Telegram or ntfy notification (whichever you use). Recurring tasks remind on each due day. Tasks without a reminder time still appear in the morning brief and evening check-in. Reminders go to the person who added the task. A check runs every 5 minutes, so a reminder can arrive up to 5 minutes after its time.
- **Email appointments** you accept on Home become tasks (with the time in the name, e.g. "Dental cleaning at 3pm"), not calendar events. Open the task to add a reminder time. The chat only adds calendar events when you ask for the calendar.

**Appointments**
Tell the chat ("Kid's dentist Oct 20 at 3pm") and it adds a Google Calendar event with reminders the day before and 2 hours before. Anything you add to Google Calendar directly also shows up on Today and in the morning brief.

**What to bring**
- Home shows it under the weather (after 6 pm, for tomorrow), and the morning brief and evening check-in include it.
- Above the list, **Bella writes a short, warm note for your day**: the plans that matter (calendar events and tasks due, with times) and what to wear or bring for them, from the weather at those times ("Soccer at 4 and it'll feel like 52° by then, so a warm layer and water for Sam 💛"). It's one small AI request per person per day (plus one for tomorrow in the evening), made again only when your plans or the weather change. Without an AI key, or if it fails, you see the plain list.
- Jacket by the coolest "feels like" between 7 am and 7 pm (warm coat below 45°F, jacket below 58°F, light jacket or sweater below 66°F; "layers" when the day swings 15°F or more), umbrella when rain is 40%+ at some hour (with the time), boots for snow, sunglasses (and sunscreen) when the UV index is high on a dry day, water on hot days, and **allergy medicine** in the months you pick in Settings → Weather (skipped on rainy days).
- Ask the chat too: "what should I bring tomorrow?".

**Food log**
- Open **Food** and tap **+**. Take or choose a **food photo** and, if you have one, the **receipt**. Add a note if you like ("shared with Sam") and who ate. Tap **Read it**: AI fills in the dish, meal (breakfast, lunch, dinner, snack, dessert, drink), homemade / restaurant / takeout / packaged, the place and date from the receipt, cuisine, ingredients, tags (sweet, spicy, light…), rough calories and protein, and the price. Check it and **Save**. *Fill in by hand* skips the AI.
- Tap any meal to edit it, rate it (😋 loved it / 🙂 fine / 😕 not again; ratings steer the ideas) or delete it.
- Or just tell the chat or the Home box: "had pho at Pho 75 for lunch", "Sam had pancakes". It logs it to the food log with an estimate (Undo on Home), also when you say "log" or "record" (meals never go to the Journal). Each night (11:30 pm), meals you only mentioned in passing in that day's chat are added too, marked *picked up from chat*.
- The log is **shared** by the household: everyone can see and add meals; only the person who logged a meal (or you) can delete it. It lives in the spreadsheet's **Meals** tab; rows typed there work too (a name is enough; lists are comma-separated, people by name).
- Photos are shrunk on the phone (meal 800 px, receipt 1600 px so it stays readable) and kept in a private **Homebase photos** folder in your Drive (an older install keeps using its existing photo folder).
- Calories are rough AI estimates, good for spotting patterns, not for exact counting.

**Taste quiz (a head start before the log fills up)**
- Food → **Take the taste quiz**. First a quick setup: whose taste, **which cuisines** you eat (American, Chinese, Italian, Japanese, Mexican, Thai, Vietnamese…; none picked = all) and **spice** (not spicy / a little / love spicy). Then rate **30 dish photos**: 😍 *Love it*, 🙂 *It's OK*, 🙅 *Not for me* (or swipe right / left). At the end, *Rate 20 more* if you like. Answers save as you go.
- For a child (like Sam), kid-friendly dishes come first (pasta, pancakes, chicken, noodles, desserts…), and offal or very spicy dishes are skipped; spice defaults to *not spicy*.
- The setup is remembered per person and goes to the food ideas too. Answers are in the spreadsheet's **Taste** tab.
- Dishes and photos come from [TheMealDB](https://www.themealdb.com), a free, crowd-sourced dish database; Homebase uses its free key, meant for development and personal projects (credited in the quiz). The dish list is fetched once (about 10 seconds) and kept for 30 days.

**Guess what I want to eat**
- Food → **Guess what I want to eat**. Quick questions: who's eating, **where** (cook at home, eat out, takeout, surprise me), which meal, how much effort (for home), and anything going on: losing weight, craving sweet or savory, something light, comfort food, high protein, on my period, low energy, something new, quick & easy, budget, kid-friendly. Plus an optional note ("have chicken and rice").
- **In the mood for:** *My usual* (go-to favourites), *Mix it up* (default: one favourite you haven't had lately, one twist on what you like, one new idea) or *Something different* (nothing from your recent rotation). Liking a dish doesn't mean wanting it every day: anything you've had a lot in the last 10 days is treated as "maybe tired of it", and nothing from the last 2 days is suggested. Each idea is labelled *A favorite*, *A twist* or *Something new*.
- **Recipes:** 📖 *Recipe* on a quiz card or a food idea opens the recipe: ingredients with amounts, steps, and often a video. Quiz dishes and ideas that match a TheMealDB dish use its recipe; other *cook at home* ideas get a short recipe the AI writes for whoever is eating (following food notes; only when you tap it).
- **Pictures:** an idea from a place or dish you've logged shows your own photo and *Last time* (what you had, when, the price, ♥ if you loved it) with a 🧾 *Receipt* button. Other ideas show a photo of a similar dish from TheMealDB when there's a close match; otherwise just an icon (no made-up pictures).
- You get **three ideas**, each with why it fits (your recent meals, places you go and liked, dishes you make, what you rated "not again"), how to make it or what to order, and rough calories. Eating out uses places from your log; new places are described by kind, not invented. **Other ideas** gives three more. **I'll have this** saves the idea under **Up next** at the top of Food with one tap (it doesn't count as eaten yet). When you've had it, tap **✓ Ate it** (logged with the time), or **📷** to add a photo/receipt that AI reads onto that same entry, or ✕ to drop it. Telling the chat "had the pho" also turns the planned one into the meal, without a duplicate.
- Food notes in Settings → People (allergies, dislikes, goals) are always respected. The chat can do the same: "I don't know what to eat" → it asks one or two questions, then suggests.

**Share to Homebase (TalkingPoints, websites, flyers)**
- Homebase appears in Android's **Share** menu once it's installed on your home screen (Chrome ⋮ → *Add to Home screen* / *Install app*; after this update remove the icon and add it again once so Android notices).
- Select text in any app or web page, or use an app's **Share** button, and pick **Homebase**. A link, a picture or a screenshot works too. The chat opens with what you shared above the message box and *"Find the dates, events and to-dos…"* ready; tap **Send**, or type your own question.
- In the chat you can also tap **📎** to add a photo or screenshot (a school flyer, a TalkingPoints message you can't copy).
- The assistant lists what it found (dates, times, places, deadlines, things to bring) and **asks before adding** anything to your calendar or tasks: reply "add all" or "just the first two".
- A shared link is read only if the page is public; pages behind a login can't be read, so share the selected text instead. Pictures are sent to Gemini once to be read and are not stored; the shared text is kept in the chat history so follow-ups work. Shared content is treated as data: instructions written inside it are ignored.

**Home: log anything in one line**
- The app opens on **Home**. Type (or tap 🎤 and say) what happened: "clipped the cat's claws", "Sam wore the blue hoodie and jeans", "dentist Oct 20 at 3", "laundry done". 📎 adds a photo or screenshot.
- If it was saved and the assistant has no question, a short confirmation appears right there (for about 8 seconds) with **Undo** (works for an hour for done tasks, new tasks, new events, meals and journal notes) and **Open in chat**. Questions, food ideas and anything the assistant needs to ask about open the **Chat** tab. Everything is kept in your chat history either way.

**Tasks: only what's coming up**
- **Recurring** chores are folded together at the very end; one only appears at the top on the day it's due (or once it's overdue).
- Tasks shows what's overdue, due today and **tomorrow**. **Next 7 days** and **Next 14 days** are folded; tap to open. Anything further out isn't listed in the app (just counted); it's in the spreadsheet, and you can ask Homebase ("what's due next month?").
- You can add many tasks at once straight in the spreadsheet's **Tasks** tab: fill in `name`, and optionally `next_due` (e.g. 12/15/2026), `interval_days` with `last_done` for repeating ones, `notes`, `category`. Leave `id` blank; Homebase fills in the rest the next time it loads.

**Log: remember anything, look it up later**
- Tell Homebase anything worth remembering, on Home or in Chat: "Sam had a fever of 101 last night, gave Tylenol at 7", "oil change at 45,000 miles, $89", "spare key is in the blue drawer". It's saved to the **Journal** tab of your spreadsheet (shared with the family unless you say "just for me"), and the Home confirmation has Undo.
- Ask about the past: "when was the last oil change?", "how many times did Sam have a fever this year?", "what did the vet say?". The assistant searches the Journal, finished tasks (with their notes), meals, measurements, and your own earlier chat messages, and answers with dates.
- Everything is kept in the spreadsheet's **Journal** tab (not shown in the app). You can also type rows there; Homebase reads them too.
- **Every night (11:30 pm)** Homebase also reads that day's conversations and saves anything worth remembering that you didn't explicitly log (what the doctor said, a price, a decision), plus a one-line day summary. These automatic records are marked `auto` and are private to the person who had the conversation.

**Charts**
- Ask for a chart in Chat (or the Home box): "chart grocery spending by month this year", "bar chart of chores done this month", "how often did we eat out each week", "pie of where the money went in September". Homebase gathers the numbers from your records, tasks and wardrobe, then draws a **line, bar, scatter or pie** chart under its reply. Tap or drag across a chart to see values; **Data** under it shows the numbers as a table. Charts stay in the conversation.
- It only plots real numbers it found (or that you give it); if there's not enough data it answers in words.

**Growth charts**
- Log measurements by just saying them: "Sam is 4 ft 2 in and 56 lb", "Sam 128 cm, 25.4 kg at the checkup". They're saved in the **Measurements** tab (Undo works on Home). Older measurements can be typed straight into that tab: `date`, `person` (name), `metric` (`height` or `weight`), `value`, `unit` (cm, in, kg or lb).
- Ask "show Sam's growth curve" (or weight, or BMI). The chart shows Sam's measurements over the **CDC percentile curves** (5th–95th, ages 2–20) and the latest percentile, in inches/pounds or cm/kg to match your units setting.
- It needs the child's **birth date** and **sex**: set them in Settings → People, or just tell the chat when it asks. The chart is for keeping track at home; the pediatrician's growth chart is the reference.

**Voice**
- Tap 🎤 (Home or Chat) to type by voice: the words appear in the box as you speak, and **2.5 seconds after you stop, it sends by itself** (no Send button). Tap 🎤 again to send at once; start typing to edit instead (then you send). It uses Chrome's speech recognition (audio goes to Google, like keyboard voice typing), so it works in Chrome, not inside WeChat's browser.
- Replies in the chat are shown as text, not read aloud (also after using 🎤). 🔊 on any reply reads it. For a spoken conversation, use talk mode.
- Settings → **Voice (this phone)**: the language you speak (English, 中文 普通话 / 台灣, 粵語, or the phone's language), **Bella's voice** (a natural Chirp voice, see setup step 6, or the phone voice), the **phone voice** used as the backup, and the **speed**, with a ▶ Test button. Each phone keeps its own choice. The assistant replies in the language you use.

**Talk mode (hands-free, e.g. while driving)**
- Start it with the 🎙 button at the top of any screen, by long-pressing the Homebase icon → **Talk to Bella**, or just by opening Homebase (*"Hey Google, open Homebase"*): **Settings → Voice → Start talking to Bella when I open Homebase** is on by default (turn it off per phone). Opening Homebase from a notification never starts it; tap **End** to type instead.
- Bella says *"Hello, I'm Bella."* and listens. Just talk: **as soon as you finish speaking**, it sends by itself (no waiting), she answers out loud, and listens again. If you pause mid-sentence, the first part may go on its own; just keep talking. Anything the chat can do works: log a meal, "remind me…", "what should I eat?", "what's due this week?", questions about past records.
- Say **"thanks"** or **"bye"** to finish (also "thank you", "goodbye", 谢谢, 拜拜, 再见). "Thanks, also add eggs" is not goodbye: it's sent. Say **"never mind"** or **"cancel"** to drop what you just said. If you say nothing twice in a row, it closes.
- Tap the circle while Bella talks to cut her off and speak; tap while you talk to send right away. **End** closes it.
- The screen stays on while it's open. Replies are kept short and spoken-style; everything also appears in Chat. Charts aren't made in talk mode.
- Limits of a web app: it can't listen in the background or with the screen off, and it doesn't appear in Android Auto. Chrome may beep each time it starts listening again. If the phone wants a tap before Homebase may speak (some phones, the first time), it shows **Tap to start**.
- The name: owner's **Settings → Assistant → Assistant's name** (default Bella).
- Settings sections are folded; tap a heading to open it. The app remembers which ones you left open.

**Family (shared Homebase with sign-in)**
- Settings → **Family** → **Invite someone**: give a name and say who they are in the People list (add them as an adult or child, or pick an existing person). You get an **invite link**; send it privately. Opening it on their phone signs them in (then ⋮ → *Add to Home screen*).
- **Shared:** tasks (unless marked *Only me*), the food log, email suggestions on Today, and the calendars you tick **Family** in Settings → Calendars. Events family members add go to the calendar chosen under *Events family members add go to* (e.g. Family), never to your own calendar.
- **Private:** each person's chat, and tasks marked **Only me** (in the task screen, or say "just for me" in chat). Only the person who added a task can make it private.
- **Only you:** your email (your chat can search all of it if you allow it; members never can), Settings for the household (location, calendars, email, AI, people), and the Family list.
- **Notifications:** everyone sets up their own in their Settings (their own ntfy topic, or Telegram: they open the family bot, tap Start, then *Link Telegram*). Morning brief and evening check-in go to each person with their own tasks and calendars.
- **Opening Homebase from a notification:** Telegram always opens Telegram when you tap its notification (Android sends the tap to the app that posted it). Each message has a button (*Open Home*, *Open Tasks*) that jumps straight to that tab. To make that button open the installed Homebase app instead of a browser page inside Telegram: in Telegram → Settings → Chat Settings, turn off the in-app browser. Homebase must be installed with Chrome's **Install app** (⋮ → Install app), not a plain home-screen shortcut. ntfy notifications open Homebase directly when tapped.
- **Pause / New link / Remove** in the Family list: pausing or a new link stops the old link at once; removing also deletes their chat and *Only me* tasks.
- Security: the invite code is stored only as a hash. Anyone with someone's link can act as them, so send links privately and make a new one if a phone is lost. Everything still runs under your Google account, so events and tasks they add are made by your account.

**Email watch**
In Settings → *Watch these emails*, tap the row to expand the list, then add one sender (an address like `office@school.org` or a whole domain like `school.org`) per row; tap ✕ to remove one. The list is collapsed by default and shows how many senders are watched. Every hour, new matching emails are read and anything with a date or action appears on Today as a suggestion. Nothing is added to your calendar or tasks until you tap.

This list is also the **only** email the chat can see. Ask "anything from the school this week?" and the search runs as *(your watched senders) AND (your question)*; emails outside it can't be found or opened from chat. Leave the list empty to turn all email reading off. (Settings → Assistant → *Let my chat search all my email* widens this to your whole mailbox, read-only; it's **off** by default.)

---

**Groceries**
- Food → **Groceries → Plan meals & list**: choose how many meals you're shopping for (3, 4, 5, 7 or 10) and anything special (quick & easy, healthy, kid-friendly, budget…). Bella suggests that many home-cooked meals from your taste and recent eating, with variety and shared ingredients so less goes to waste. Open 📖 for a recipe, ↻ to swap one, ✕ to drop it.
- **Make shopping list** adds up the ingredients of all the meals into one list by store section (produce, meat & seafood, dairy & eggs…), showing which meal needs what. The meals also go under **Up next**.
- Tap anything you already have to scratch it, and tick things off the same way in the store. Add extra items at the top. **Copy list** gives plain text to paste into a message. The list is shared with the family.
- A task like "Grocery shopping" or "Costco run" gets a **🛒 Plan** button. In the chat, say you're going shopping and Bella asks how many meals; you can also say "add milk to the grocery list" or ask "what's on the list?", including in talk mode.

**Bella's personality and who's talking**
- Bella acts as the family's caring house manager: warm and friendly, practical first, with kind nudges (a jacket, water, rest) and no nagging.
- She knows who is using each phone from its sign-in. On a shared phone, say **"This is <name>"** (or "It's <name>", "我是<name>") in chat or talk mode: Bella talks with that person and logs things for them for the next 30 minutes. With a child she uses simple, gentle words, tells them to get a grown-up for anything worrying, and email and deleting are off. (Chrome can't recognise *voices*, so saying the name is how she knows.) The conversation is still saved in the phone owner's chat.

**Dates you can trust**
- Bella gets a calendar with every weekday around today, so she never works out weekdays herself. She can also pass your own words ("yesterday", "next Tue", "Oct 20", "明天") and Homebase converts them the same way every time.
- Before anything is saved, its date is checked against what you actually said (or the email or flyer it came from). A mismatch, such as "yesterday" saved as today, or "Friday" saved as Saturday, is blocked: nothing is saved, and Bella fixes it or asks you. Things that already happened can't get a future date.
- Dates in her replies are checked too: "Friday, Oct 17" when Oct 17 is a Saturday gets corrected before you see it. What changed shows the weekday ("Added task … (Fri 2026-10-16)") so a wrong day is easy to spot and undo.
- Every record keeps the time it was saved ("logged at"). Bella doesn't mention it unless you ask, e.g. "what time did I log the fever?".

**Nightly brief and Bella's memory**
- At 11:30pm Bella reads **all** of the day's conversation (in parts, however long it was) and saves to the Journal: facts and events, meals, **open items** (things still to do or follow up, like "ask the school about Friday pickup"), and **important yearly dates**. A fact whose date is unclear is still saved, on that day, marked "(date unsure)".
- Then she posts **"Here's your day"** in your chat: what you talked about, what got done, new tasks, what was eaten, **every note she saved** (so you can spot anything missing and just tell her), open items, new yearly reminders, what's still due and what's coming tomorrow. On a day you didn't use Homebase, nothing is posted.
- The app's chat starts fresh from that message. **Nothing is ever deleted:** chat older than 30 days moves to the **ChatArchive** tab (a new ChatArchive2… tab every 200,000 rows), and "Clear chat history" only clears the app's view.
- Asking about the past searches in layers: last night's brief and recent notes → the Journal, meals, tasks and measurements → the last 30 days of chat → the archive (when nothing else answers it fully). If the answer comes from an old conversation, Bella tells you when it was said.
- If the nightly job runs out of time (Apps Script allows 6 minutes per run), it carries on a minute later where it stopped.
- When you type in the chat, replies are shown, not read aloud. Only the mic and talk mode read replies.

**Important dates and birthdays**
- Mention an anniversary, birthday, renewal or any date that comes every year ("our anniversary is Nov 3"), and Bella creates a yearly reminder right away: **a week before (9am) and on the day (8am)**. The nightly memory catches ones she missed. New ones are listed in the nightly brief; say "that's wrong" or tap Undo to change them.
- Everyone with a birth date in **Settings → People** gets a yearly birthday reminder, sent to the grown-ups (not to the child, and not to the birthday person).
- The morning brief adds **"Coming up"** for yearly dates in the next 7 days. A yearly date that passes without being ticked off simply moves on to next year.

**Tasks: what the app shows**
- The Tasks tab shows only **overdue and today, tomorrow, and the next 7 days** (recurring chores and yearly dates too, when they come due). Everything further out is kept in the Sheet's Tasks tab, and Bella sees the whole list: ask "what's coming up next month?" or "when is the furnace filter due?".
- Before adding a task, Bella checks for one that's already there (the same thing worded differently) and updates it instead. Adding one by hand that looks like an existing task asks "Add another one anyway?". Accepting an email suggestion that's already a task doesn't add it twice.

## Notes and limits

- **Data.** The Sheet and code live in your Google account. Text sent to Gemini (chat, household and food notes, meal photos you ask it to read, watched emails) is covered by the free-tier terms above. Only emails matching your watch query are read, whether by the hourly check or by chat.
- **Gmail is read-only, enforced by Google.** The project is granted only the `gmail.readonly` permission, so it cannot send, delete, label or change email; Google blocks it even if the code were edited. Read access technically covers your mailbox, and Homebase's code then limits reading to your watch query. You can review or remove access at myaccount.google.com → Security → Your connections to third-party apps & services.
- **Security.** The web app is reachable by anyone with its URL *and* the token. If you think the token leaked, delete the `APP_TOKEN` script property, run `setup` again, and paste the new token in the app.
- **Speed.**
  - *Tabs open instantly:* the app keeps a copy of everything on your phone and shows it at once; one background request refreshes all tabs together (at most once a minute, or when you come back to the app). The app's own files also load from the phone, and a new version is picked up the next time you open it.
  - *Food ideas* take a few seconds (one AI request on the food ideas model); the questions themselves need no server call. Reading a meal photo takes a few seconds too.
  - The first request after a quiet period is slower while Google wakes the script, but you won't wait for it: the saved copy is already on screen.
  - *Chat replies:* Bella's fixed instructions are cached by Claude, so only today's details (time, tasks, notes) are read fresh each message. A plain answer takes one AI step; logging something takes two (do it, then confirm). In talk mode the voice comes back with the reply. **Settings → AI models** shows how long the last reply took and where the time went (AI, reading the Sheet, actions, saving, voice).
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
| Bella uses the phone voice, not the natural one | Settings → Voice shows why. Usually: `TTS_API_KEY` missing, the Cloud Text-to-Speech API not enabled, or billing not turned on for that Google Cloud project. Run `testVoice`. Also once this month's free amount is used up. |
| Talk mode doesn't start with "Hey Google, open Homebase" | Turn on Settings → Voice → *Start talking to Bella when I open Homebase* (it's per phone). If Homebase was already open in the background, it starts when you come back after 10+ minutes; otherwise tap 🎙. |
| Talk mode stops listening | It pauses when the screen turns off or you switch apps, and picks up when you come back. "Allow the microphone…": Chrome → ⋮ → Settings → Site settings → Microphone → allow your Homebase address. |
| Timed reminders don't arrive | In Apps Script → **Triggers** (clock icon), there should be a `taskReminders` trigger every 5 minutes. If it's missing, run `setup` once. Then check Settings → Send test notification. |
| Errors in general | Apps Script → **Executions** shows each run and its error. |
