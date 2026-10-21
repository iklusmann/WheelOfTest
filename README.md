# WheelOfTest

A small QA task roulette for one team. People join a room through a link, the moderator spins the wheel once, and every test task gets an owner. Each room starts with the 22 default tasks, and the moderator can edit, add or delete tasks for that room until the first spin. If at least two people complain, the moderator can run one final spin.

Static site (HTML, CSS, vanilla ES modules, no build step) on GitHub Pages, with Supabase for the room database, anonymous auth and realtime.

```text
index.html  styles.css  app.js  config.js  tasks.js  domain.js  backend.js  ui.js  reveal.js
tests.html  supabase/schema.sql  .github/workflows/deploy.yml
```

## Setup

### 1. Create a Supabase project and enable anonymous sign-ins

1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → Sign In / Providers**: turn on **Allow anonymous sign-ins**. Without it, every visitor gets "Anonymous sign-ins are disabled".
3. **Authentication → Rate Limits**: anonymous sign-ins default to **30 per hour per IP address**. A team behind one office IP can hit that while filling a single room, so raise it (for example to 200).
4. **Realtime → Settings**: leave **Allow public access** on. The app uses a public channel per room. Room data is still protected, because Postgres changes are filtered by RLS and the channel name contains the room's UUID, which only members can read.

### 2. Run the schema

Open **SQL Editor**, paste all of `supabase/schema.sql`, and run it. It creates the four tables with constraints, enables RLS, revokes the default client grants, creates the RPCs, and adds `rooms` to the `supabase_realtime` publication. It is safe to run again.

**Upgrading from the version without editable tasks:** run `schema.sql` again, then deploy the new frontend straight away. Existing rooms keep working: their tasks are stored in the old shape (`platform`/`device`), and both the database and the app still read it. Anyone who has the old page open should reload, because the old page sends tasks in a shape the new schema no longer accepts.

### 3. Configure the frontend

Click **Connect** in the dashboard (or go to **Settings → API Keys**) and put two values into `.env`:

```sh
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # the legacy anon key also works
TEAM_OPTIONS=AF,CYD,PB                        # optional
```

Then run `node scripts/build-env.mjs` (Node 20.12+) to generate `env.js`, which `config.js` reads. Re-run it after every `.env` change. `.env` and `env.js` are git-ignored; for GitHub Pages, set the same names as repository **variables** (the deploy workflow generates `env.js`).

Both values are public by design. Never put the secret/service-role key or the database password in `.env`.

`config.js` also holds `roomCapacity` (30) and `complaintThreshold` (2). The database enforces both through `public.wot_room_capacity()` and `public.wot_complaint_threshold()` in `schema.sql`. The same goes for `maxTasks` (50) and `taskNameMaxLength` (60), which `public._wot_clean_tasks()` enforces. If you change one side, change the other.

### 4. Run locally

ES modules do not load from `file://`, so serve the folder:

```sh
python -m http.server 8000
```

Open <http://localhost:8000>. To try multiplayer, use two browser profiles (or one normal and one private window). Each profile is a separate anonymous user. Two tabs in the same profile are the same person.

Domain tests: open <http://localhost:8000/tests.html>. They need no Supabase project.

### 5. Deploy to GitHub Pages

1. Push the repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the workflow manually). `.github/workflows/deploy.yml` publishes the repository root.

All paths are relative, so the site works at `https://USERNAME.github.io/REPOSITORY/`.

## Tasks

The 22 default tasks live in `tasks.js` (`DEFAULT_TASKS`). They never change at runtime: every new room starts from a fresh copy, and edits only ever apply to that one room.

Each task has a **name**, one **team** (or **All teams**), a **theme**, and three sets of options you select or deselect: **devices** (Desktop, Android, iOS; at least one), **browsers** and **user levels** (both optional). The **+** beside each of those three labels selects every option in the group (it greys out once everything is selected). The option lists are also in `tasks.js`.

- **On the Create room screen**, the task section shows "22 tasks · default set". **Review** opens the list, grouped by team. You can edit, delete, add, or reset to the defaults before creating the room. These are local until you click **Create room**.
- **In the room, before the first spin**, everyone sees the task list. Only the moderator can change it, and changes reach everyone immediately through the same realtime update the room already uses. The wheel status shows the new count.
- **After the first spin** the list is locked (the database refuses `update_tasks` with `tasks_locked`) and the result table shows the tasks.
- Delete and Reset need a second press within 4 seconds, so a stray click can't remove anything. A room always keeps at least one task, and at most 50.

**Changing the options:** browsers, user levels and themes are display data. Add an entry to the list in `tasks.js` and it shows up in the editor; the database accepts any short string there. Devices drive assignment, so the database only accepts `desktop`, `android` and `ios`. Team names are checked in `schema.sql` too (as before).

## How the assignment works

When the moderator clicks **Spin**, their browser runs `assignTasks` from `domain.js` and sends the result to the `commit_spin` RPC, which validates and stores it. Every other browser only displays what the database stored.

1. Only people who are **online** right now (Realtime Presence) are considered. The moderator always counts as online.
2. Team tasks are shuffled and assigned first, then the "All teams" tasks, so those even out the load at the end.
3. For each task:
   - **Phone rule (absolute):** if a task has Android and/or iOS selected, it can only go to someone with **one of the selected phones**. Android only means Android owners, iOS only means iOS owners, Android + iOS means anyone with a phone (that's what the default mobile tasks use). Desktop alongside a phone doesn't loosen this. If nobody online has a matching phone, the task is shown as **Unassigned** with the reason (for example "No one online has an Android phone.") and the spin still succeeds. Tasks with only Desktop can go to anyone.
   - **Team preference (soft):** among compatible people, members of the task's team are preferred. A task goes cross-team only when no compatible member of that team is online. The table marks it **Cross-team**.
   - Within that pool, the person with the fewest tasks so far gets it. Ties are broken randomly.

**Load-balancing caveat:** the load is balanced within each pool, not across the whole room. A team with only one member online gives that person **all** of the team's tasks (6 for AF, for example), while others may get fewer. Two people on the same team who both have a phone (or both have none) always end within one task of each other.

**Accepted trade-off:** because the moderator's browser computes the result, a moderator could submit a hand-picked assignment through the API. The database still enforces who may spin (only the host), how often (at most twice, the second only after 2+ complaints), that every task appears exactly once, that assignees are room members, and the phone rule. It also enforces who may change tasks (only the host), when (only before the first spin), and the shape of every task. It also stores names and team-match flags from its own tables, not from the client. This is an internal team tool: the room link is an open invitation, and a display name is not an identity.

## Limitations

- **Identity lives in the browser.** Clearing site data, switching browser or device, or using a private window creates a new anonymous user. That user has to re-join from the link. A **moderator who does this loses moderator rights** for that room and can't get them back, so start a new room.
- **Presence is reported by the browsers.** "Online" means the client says so. Only people online at the moment of the spin get tasks.
- **Rooms never expire.** Anonymous users and rooms accumulate. Deleting a user in **Authentication → Users** also deletes their rooms and memberships (cascade).
- **The reveal plays once per open tab.** It is tracked in memory, not in storage. Reloading or reconnecting shows the table without animation. Two open tabs each animate.
- **The Supabase library loads from jsDelivr** (`@supabase/supabase-js@2.117.3`, pinned). If that CDN is blocked, the app shows an error instead of loading.
- Maximum 30 people and two spins per room. A new session means a new room.
- If the moderator edits tasks in two tabs at once, the last save wins. A spin from a tab that hasn't seen the latest task edit is refused as out of date, and that tab refreshes.
- The moderator can spin only after the room is connected, re-fetched and has received a Presence update, so who is online is never guessed.
- Needs a current browser (Chrome/Edge 111+, Safari 16.2+, Firefox 121+). The design uses container queries, `:has()` and `color-mix()`, and follows the device's light or dark appearance.

## Manual checks (need a live Supabase project)

Run these with two browser profiles: **M** (moderator) and **P** (participant). For the console snippets, open DevTools on the room page:

```js
const { CONFIG } = await import("./config.js");
const sb = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabasePublishableKey); // reuses the stored session
const { data: snap } = await sb.rpc("get_room", { p_code: new URLSearchParams(location.search).get("room") });
```

A "Multiple GoTrueClient instances" console warning here is expected and harmless.

- [ ] **Join from a second browser.** M creates a room and copies the invite link. P opens it, fills the form and joins. Both see each other as Online, and M sees "2 in the room · 2 online".
- [ ] **Non-moderator cannot spin.** P sees no Spin button. In P's console, `await sb.rpc("commit_spin", { p_room_id: snap.room.id, p_spin_number: 1, p_assignments: [] })` returns an error "Only the moderator can spin." with hint `not_host`.
- [ ] **Direct table writes are rejected.** In P's or M's console, `await sb.from("rooms").update({ status: "final" }).eq("id", snap.room.id)` and `await sb.from("complaints").insert({ room_id: snap.room.id, user_id: snap.room.host_user_id })` both return a permission error (`42501`). `await sb.from("participants").select()` returns only members of rooms you belong to.
- [ ] **Spin and reveal.** M spins. Both browsers play the wheel, burst and table reveal, show the same table, and highlight their own rows with "You have N tasks".
- [ ] **Reveal plays once.** Reload P: the table appears immediately, with no animation.
- [ ] **Spin 2 is blocked below two complaints.** With 0 or 1 complaint, M's **Spin again** is disabled. In M's console, `commit_spin` with `p_spin_number: 2` returns "A second spin needs at least 2 complaints."
- [ ] **Duplicate complaint.** P complains: the count becomes "1 of 2" everywhere and P's button reads "You complained". Calling `await sb.rpc("complain", { p_room_id: snap.room.id })` again leaves the count at 1, with no error.
- [ ] **Third complaint.** Add a third profile, or let M complain. The count goes past the threshold ("3 complaints · second spin unlocked") and no spin starts on its own.
- [ ] **Second spin is final.** M clicks **Spin again**. Everyone sees the reveal and "Final result". Complain and spin buttons disappear, and **Show first spin** shows the original table.
- [ ] **Tasks on the create form.** On the start page, **Review** shows 22 tasks grouped by team. Delete one (two presses), edit one, add one, then create the room. The room's task list matches what you left.
- [ ] **Tasks in the lobby.** With P in the room, M deletes or edits a task: P's list updates within a second, and P has no edit buttons. In P's console, `await sb.rpc("update_tasks", { p_room_id: snap.room.id, p_tasks: snap.room.tasks })` returns "Only the moderator can change the tasks." with hint `not_host`.
- [ ] **Device rule.** M sets a task to Android only while nobody online has Android, then spins: that task is Unassigned with "No one online has an Android phone."
- [ ] **Tasks lock at the first spin.** After the spin, the task panel is gone, and `update_tasks` from M's console returns hint `tasks_locked`.
- [ ] **Defaults stay default.** Open the start page again: it shows "22 tasks · default set", whatever you changed in earlier rooms.
- [ ] **Reconnect re-fetches state.** In P's DevTools, set Network to *Offline*: the header shows "Reconnecting…". Meanwhile M complains or spins. Set P back to *Online*: the header returns to "Connected" and P shows the new state without replaying the reveal. While M is reconnecting, M's spin buttons are disabled.

## Troubleshooting

- **Stuck on "Reconnecting…"**: check that `schema.sql` ran (it adds `rooms` to the `supabase_realtime` publication) and that Realtime **Allow public access** is on. The browser console logs the realtime error.
- **"The database functions are missing"**: run `supabase/schema.sql`.
- **"Anonymous sign-ins are disabled"**: see setup step 1.
