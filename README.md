# WheelOfTest

A small QA task roulette for one team. People join a room through a link, the moderator spins the wheel once, and the test tasks are shared out. Each room starts with the 34 default tasks, and the moderator can edit, add or delete tasks for that room until the first spin. Testers say which devices they have (Desktop always, plus Mac, Android, iOS), and each task only goes to someone who has its device. If at least two people complain, the moderator can run one final spin. The room's **tasks per person** setting is the most tasks anyone gets from the spin (2 by default: one from their own team, one cross-team), and no task gets more than two testers from it. After a spin, the moderator can change who tests any task, and add, edit or delete tasks; anyone can ask to take over a tester's place, and the moderator or that tester approves. Two session links, set when the room is created, sit at the top of the room. Anyone can **export** the result for Confluence: a table to paste, or wiki markup. The teams are AF, CYD, PB and **UI/UX**; the two **Visual Regression Check** tasks go only to UI/UX in the spin, and anyone can assign themselves afterwards. People who **join after the spin** assign themselves tasks that still have a free place.

Static site (HTML, CSS, vanilla ES modules, no build step) on GitHub Pages, with Supabase for the room database, anonymous auth and realtime.

```text
index.html  styles.css  app.js  config.js  tasks.js  domain.js  export.js  backend.js  ui.js  reveal.js
tests.html  supabase/schema.sql  scripts/build-env.mjs  .github/workflows/deploy.yml
```

## Setup

### 1. Create a Supabase project and enable anonymous sign-ins

1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → Sign In / Providers**: turn on **Allow anonymous sign-ins**. Without it, every visitor gets "Anonymous sign-ins are disabled".
3. **Authentication → Rate Limits**: anonymous sign-ins default to **30 per hour per IP address**. A team behind one office IP can hit that while filling a single room, so raise it (for example to 200).
4. **Realtime → Settings**: leave **Allow public access** on. The app uses a public channel per room. Room data is still protected, because Postgres changes are filtered by RLS and the channel name contains the room's UUID, which only members can read.

### 2. Run the schema

Open **SQL Editor**, paste all of `supabase/schema.sql`, and run it. It creates the five tables with constraints, enables RLS, revokes the default client grants, creates the RPCs, and adds `rooms` to the `supabase_realtime` publication. It is safe to run again.

**Upgrading from an earlier version:** run `schema.sql` again, then deploy the new frontend straight away. This version adds the **UI/UX** team (the team check on `participants` is replaced, existing people keep theirs), **team-only tasks** (`team_only` in the task JSON; tasks stored before have none and are open to every team), and tells someone opening a room link whether the wheel has spun (`get_room` returns `spun` to non-members). It also makes **tasks per person a maximum** (new rooms default to 2; existing rooms keep their stored value, which now caps instead of guarantees), lets `commit_spin` leave a Desktop task empty when everyone who could take it is full (the client marks those `full`), refuses a spin that gives anyone more than tasks per person or a task more than two testers, and renames `wot_max_testers_to_join()` to `wot_max_testers_per_task()`. A page from before this still spins by the old rules, so the database refuses its spin with "Reload the page and spin again." Earlier upgrades are included too: it adds the room settings (`rooms.tasks_per_person`, now default 2, and `rooms.links`, default none), several testers per task, the `takeover_requests` table with its place column (`from_user_id`, filled in for requests made before), the functions `update_settings`, `save_task`, `delete_task`, `request_takeover`, `resolve_takeover` and `withdraw_takeover`, and, from older versions still, the `mac` column on `participants` (existing people get `false`). `create_room` and `request_takeover` gained a parameter with a default; the old two-parameter versions are dropped, so a page that is still open keeps working. Spins stored before this keep one tester per task in the old shape; the database and the app read both, and an entry is converted the first time it is changed. Rooms created before this have no session links (the moderator can add them in the room). Existing rooms keep working: rooms from before tasks were editable store tasks in the old shape (`platform`/`device`), and both the database and the app still read it. A frontend deployed before the schema is updated shows "The database functions are missing" when someone presses **Take over**; the rest keeps working. Anyone who has an old page open should reload.

### 3. Configure the frontend

Click **Connect** in the dashboard (or go to **Settings → API Keys**) and put two values into `.env`:

```sh
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # the legacy anon key also works
TEAM_OPTIONS=AF,CYD,PB,UI/UX                  # optional; keep UI/UX in it (see below)
SESSION_LINK_1="Test environment | https://staging.example.com"   # optional, see below
SESSION_LINK_2="Test cases | https://docs.example.com/test-cases"  # optional
```

`TEAM_OPTIONS` lists the teams on the join form, in that order (default: all four). The database accepts AF, CYD, PB and UI/UX only. If you set it, keep **UI/UX** in it: without it nobody can join as UI/UX, and the Visual Regression tasks stay open after every spin. That matters if your GitHub repository variable still says `AF,CYD,PB`.

Then run `node scripts/build-env.mjs` (Node 20.12+) to generate `env.js`, which `config.js` reads. Re-run it after every `.env` change. `.env` and `env.js` are git-ignored; for GitHub Pages, set the same names as repository **variables** (the deploy workflow generates `env.js`).

**Session links.** Every room has up to two links the team uses in the session (for example the test environment and the test cases). They are set on the **Create room** form and show up as buttons in a bar at the top of the room, above the wheel, opening in a new tab; the moderator can change them in the room with **Edit links** at any time. `SESSION_LINK_1` and `SESSION_LINK_2` are the **defaults** the create form starts with: the moderator can keep, change or clear them for each room. The format is `Label | URL`; without a label the host name is shown. Only `http(s)` URLs are accepted (anything else is ignored with a warning in the browser console, and the database refuses it). Put the value in quotes in `.env` (as above): an unquoted value is cut at the first `#`, so a URL with a fragment would lose it. In a GitHub repository variable, enter the bare `Label | URL` (quotes are tolerated there too).

When either session link is unset, its built-in QA Testing or Release Changelog link is used. Set the corresponding variable to override it.

Both values are public by design. Never put the secret/service-role key or the database password in `.env`.

`config.js` also holds `roomCapacity` (30) and `complaintThreshold` (2). The database enforces both through `public.wot_room_capacity()` and `public.wot_complaint_threshold()` in `schema.sql`. The same goes for `maxTasks` (50) and `taskNameMaxLength` (60), which `public._wot_clean_tasks()` enforces, for `maxPendingRequests` (5, `public.wot_max_pending_requests()`), for `maxTasksPerPerson` (10, `public.wot_max_tasks_per_person()`), for `defaultTasksPerPerson` (2, the column default of `rooms.tasks_per_person` and `public._wot_clean_tasks_per_person()`) and for `maxTestersPerTask` (2, `public.wot_max_testers_per_task()`). If you change one side, change the other.

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

The 34 default tasks live in `tasks.js` (`DEFAULT_TASKS`): every release (Critical User Flows, AF, PB, CD) × theme (E3DC, Flow) × device (Desktop, Mac, Android, iOS), plus **Visual Regression Check** for E3DC and Flow (Desktop, team UI/UX, UI/UX only). Each tester covers every browser and every user level of a task, so there is one task per device instead of one per browser:

| Device | Browsers shown | Who can take it |
| --- | --- | --- |
| Desktop | Chrome, Edge, Firefox | anyone |
| Mac | Safari (automatic) | someone with a Mac |
| Android | none (the app) | someone with Android |
| iOS | none (the app) | someone with iOS |

All four user levels (Owner, Installer, Partner, Service) are on every task.

**Team-only tasks.** A task with a team can be marked **Only this team gets it from the spin** (a switch under Team in the task editor; off and disabled for All teams). The two Visual Regression tasks are. The spin gives such a task only to members of its team, and leaves it open with "At the spin, no one from UI/UX online could take it." when none is online. It is only about the spin: afterwards anyone with the devices can **Assign me** (up to 2 testers) or ask to take it over, and the moderator can give it to anyone, as many as they like. The lists before the spin mark them "UI/UX only". The defaults never change at runtime: every new room starts from a fresh copy, and edits only ever apply to that one room.

**Critical User Flows is optional.** The **Critical User Flows** switch next to Add task / Reset leaves all 8 of them out (including any you edited) or puts the defaults back. It's on the create form and in the moderator's lobby view.

Each task has a **name**, one **team** (or **All teams**), a **theme**, and three sets of options you select or deselect: **devices** (Desktop, Mac, Android, iOS; at least one), **browsers** (Chrome, Edge, Firefox; they apply to Desktop, so the group is disabled without it) and **user levels**. A new task starts with Desktop, every browser and every user level selected. The **+** beside each of those three labels selects every option in the group (it greys out once everything is selected). Safari is not a browser option: selecting Mac means Safari.

- **On the Create room screen**, the task section shows "34 tasks · default set". **Review** opens the list, grouped by team. You can edit, delete, add, switch Critical User Flows off, or reset to the defaults before creating the room. These are local until you click **Create room**.
- **In the room, before the first spin**, everyone sees the task list. Only the moderator can change it, and changes reach everyone immediately through the same realtime update the room already uses. The wheel status shows the new count.
- **After the first spin** the lobby list is locked (the database refuses `update_tasks` with `tasks_locked`) and the result table shows the tasks. From then on the moderator changes tasks one at a time in the table (see [The moderator after the spin](#the-moderator-after-the-spin)).
- Delete and Reset need a second press within 4 seconds, so a stray click can't remove anything. A room always keeps at least one task, and at most 50.

**Changing the options:** browsers, user levels and themes are display data. Add an entry to the list in `tasks.js` and it shows up in the editor; the database accepts any short string there. Devices drive assignment, so the database only accepts `desktop`, `mac`, `android` and `ios`. Team names are checked in `schema.sql` too: AF, CYD, PB and UI/UX, in `_wot_clean_profile()`, `_wot_clean_tasks()` and the `participants_team_check` constraint. To add a team, add it there and to `TEAM_OPTIONS` (or the default in `config.js`), and give it a colour in `styles.css` (`[data-team="…"]`).

## How the assignment works

When the moderator clicks **Spin**, their browser runs `assignTasks` from `domain.js` and sends the result to the `commit_spin` RPC, which validates and stores it. Every other browser only displays what the database stored.

Only people who are **online** right now (Realtime Presence) are considered; the moderator always counts as online. Then three hard rules:

- **Device rule:** a Mac task only goes to someone with a Mac. A task with Android and/or iOS only goes to someone with **one of the selected phones** (Android + iOS on one task means either phone). A task with Mac and a phone needs both. Desktop alongside them doesn't loosen this; a Desktop-only task can go to anyone.
- **Team-only tasks** go only to members of their team (the Visual Regression tasks: UI/UX).
- **Tasks per person is a maximum:** nobody gets more than the room's **tasks per person** from the spin (default 2).
- **At most 2 testers per task** (`maxTestersPerTask`), and nobody twice on one task.

Within those, the spin follows these goals in order; an earlier one always wins over a later one:

1. **As many people as possible get a task.**
2. **As many tasks as possible are handed out**, so everyone gets tasks per person when the tasks and places allow it.
3. **Even loads** (this only matters above 2 per person).
4. **One own team's task, one cross-team.** With 2 per person, each person's first task is from their own team and the second from another team or an **All teams** task (Critical User Flows counts as cross-team; for a UI/UX member, a Visual Regression task is their own team's). With 1, it's their own team's or an All teams task. Above 2, the first two follow this and the rest go where they're needed. Someone gets two of one kind only when every task of the other kind they could take is full, or there is none (for example, their team's tasks all need a phone they don't have). The table marks other teams' tasks **Cross-team**.
5. **As many tasks as possible get a tester**; a task gets a second tester only when no free task is left for that person.
6. Among equally good results, chance decides.

This is solved exactly (a small min-cost flow over people, their own-team and cross-team slots, and tasks), not by a greedy pass, so the counts never depend on luck: only who gets which of equally good tasks does. The domain tests check it against a brute-force search.

**Tasks stay unassigned** when nobody online can take them. Either nobody has the Mac or phone they need ("No one online has a Mac."), nobody of the team is online for a team-only task ("At the spin, no one from UI/UX online could take it."), or everyone who could take them is full ("At the spin, everyone who could take it already had 2 tasks."). The spin still succeeds. With few people that's normal: 8 people × 2 tasks leave most of the 34 default tasks open. People can pick them up with **Assign me**, or the moderator assigns them.

Before the spin, the moderator sees a warning under **Spin** with the exact outcome, for example "16 tasks will stay unassigned: everyone online who can take them already has 2 tasks." or "2 people won't get 2 tasks: Ada can take only 1, …", with what to do (raise tasks per person, add tasks they have the devices for, or ask people to turn on their Mac and phones).

**Tasks per person** is set on the **Create room** form (1 to 10, default 2) and the moderator can change it in the lobby with the stepper above the task list, until the first spin; everyone else sees the value there. The result shows "The spin gave everyone up to N tasks." It only shapes the spin: afterwards, **Assign me** and takeovers aren't limited by it, and neither is the moderator.

**Accepted trade-off:** because the moderator's browser computes the result, a moderator could submit a hand-picked assignment through the API. The database still enforces who may spin (only the host), how often (at most twice, the second only after 2+ complaints), that every task appears exactly once, that assignees are room members, the device rule, at most tasks-per-person tasks per person and at most two testers per task. It also enforces who may change tasks (only the host), when (only before the first spin), and the shape of every task. It also stores names and team-match flags from its own tables, not from the client. This is an internal team tool: the room link is an open invitation, and a display name is not an identity.

## The moderator after the spin

After the wheel has spun (also after the final spin), the moderator can change the result directly, without requests. Everything happens in the result table and reaches everyone at once:

- **Change testers** under each task opens a list of everyone in the room. Check or uncheck people and **Save**. People without the Mac or phone the task needs can't be checked, and offline people are marked. Uncheck everyone to leave the task **Unassigned** ("Unassigned by the moderator."). New testers show "Added by the moderator"; testers who stay keep their history.
- **Add task** (above the table) opens the task editor with a **Testers** section. It suggests someone online with the devices and the fewest tasks; change it as you like. The task is added to the room's list, so a second spin includes it too.
- The **pencil** on a task opens the same editor: change the task and its testers together. If you change the devices so that a tester no longer qualifies, they are unchecked and the editor says who ("Unchecked Ada: no device for this task any more."). The database refuses any tester without the devices, by name.
- The **trash** deletes a task (two presses). It leaves the room's list and the current spin; the first spin keeps it if you're looking at **Show first spin**. A room keeps at least one task.
- **Requests follow the changes.** If someone who asked for a task is made a tester (by you, a takeover, or Assign me), their request is settled, also a declined one. Requests for the place of someone you removed end, and so do refusals that person made, so the people they turned down can ask the new testers. Deleting a task ends its requests.
- **Spins win here too.** These changes are tied to the spin on screen: if a new spin lands meanwhile, the change is refused as out of date and the room refreshes.
- Everyone affected is told: "The moderator gave you …", "You are no longer on …", "The moderator deleted …", "The moderator added … and gave it to you".
- Tasks per person and the two-tester limit don't bind the moderator after the spin: their changes are final, so they can give someone a third task or put a third tester on a task.

## Joining after the spin

Anyone with the room link can still join after the spin (also after the final spin), up to the room's capacity. Before joining, the form says the wheel has already spun. A late joiner has no task from the spin, so the result shows "You joined after the spin. Pick tasks with Assign me: any task with fewer than 2 testers." (or, if every task they could take has 2 testers, to ask to take over a place or ask the moderator). They pick tasks with **Assign me**, like anyone else, including the Visual Regression tasks whatever their team. Tasks per person doesn't limit this. They never appear in the first spin's table, and a second spin includes them like everyone else online.

## Taking over a task

Once the wheel has spun, there are two ways to get a task you have the Mac or phone for:

- **Assign me** (the solid blue button with a +) adds you as an extra tester, right away and without approval, while the task has fewer than 2 testers (`maxTestersPerTask`). Tasks per person doesn't limit it. Nothing is taken from anyone. You can **Leave** a task you assigned yourself to (two presses); someone who tests the task hears that you joined. This is also how you pick up an **Unassigned** task.
- **Take over** (the outlined button with two arrows) asks for one tester's place; it needs approval, as described below.

So every task you don't test has a **Take over** button for each tester. On a task with several testers there is one per tester ("Take over from Ada"), because you ask for one person's place; an unassigned task has **Take this task**. Pressing it sends a request. Requests show up for everyone in a **Takeover requests** box above the table, and the person who has the task sees the request on their own row too.

- **Who answers:** the person whose place you asked for, or the moderator. Either can **Approve** or **Decline** (Decline needs a second press). A request for an **Unassigned** task (nobody online had the device at spin time) is answered by the moderator alone, so someone who joins later with the right phone can pick it up.
- **Approving** moves the task: the row shows the new owner and a note "Took over from …", "You have N tasks" and **My tasks only** follow, and the team-match column is recomputed. Nothing else changes: complaints stay as they are, and the task list stays locked.
- **One request per task per spin, at most 5 waiting at once.** To ask for another tester's place on the same task, withdraw the first request. While a request is pending you can **Withdraw** it (from the row or the box) and ask again later. A **declined** request stays declined for that spin, for every place on the task, so nobody gets asked twice; the row shows a "Declined" tag. It is lifted when the person who declined no longer has the task. Whoever may answer it still sees it in the box, greyed out, with **Approve after all** for a change of mind; if you no longer want the task, **Dismiss** takes it out of their box (it stays declined for you). The moderator can also ask for tasks and approve their own request (the box shows **Approve** next to their **Withdraw**). If two people answer the same request at the same moment: the same decision twice is fine, an approval followed by a decline gets "That request is no longer pending" and the refreshed room, and a decline followed by an approval goes through (that is the Approve-after-all path).
- **When a task changes hands,** other people's pending requests for it stay and are now for the new owner to answer, and earlier refusals by the previous owner are lifted, so those people can ask the new owner.
- **You hear about it.** Changes other people make reach everyone through the realtime update: the row and the box update, "You have N tasks" pulses when your count changes, and a screen reader is told what happened to you ("Ada asks to take over … from you", "… is now yours", "Your request for … was declined", "… went to Bob").
- **Spins win.** The second spin reassigns everything, and every request that was still pending is dropped (marked `superseded` in the database). Requests keep working after the final spin, so the final table can still be adjusted by hand. **Show first spin** shows the first table as it was when it was replaced, including takeovers that happened to it; it has no buttons.
- **The database checks everything**: that you're in the room, that the wheel has spun, that the task is in the current spin and not already yours, that you have the device it needs (also at approval time, since `join_room` can be called again with different devices), and who may answer. The three functions lock the room row like `commit_spin` does, so a request and a spin never interleave.

The request itself is stored in `takeover_requests` (one row per person, task and spin); an approved takeover is written into the spin's `assignments` with `took_over_from` and `took_over_at`.

## Export for Confluence

**Export** (above the result table, for everyone) exports the spin on screen: every task with its theme, team, devices, browsers, user levels and testers ("Ada (AF), Bob (PB)", or "Unassigned – why"). Showing the first spin exports that one. Two formats:

- **Table** (the default). **Copy table** puts a real HTML table on the clipboard, with tab-separated text beside it. Pasted into a Confluence page, it becomes a native table, in Confluence Cloud and Data Center alike; Word, Excel and Google Sheets take it too. **Download .html** saves a small web page with a title, a line of context (room, tasks assigned, tasks per person, when it was spun) and the same table.
- **Wiki markup**. **Copy markup** copies Confluence wiki markup (`||Task||…||` then `|…|` rows, special characters escaped). In Confluence **Data Center or Server**, use **Insert → Markup → Confluence wiki** and paste. **Download .txt** adds an `h2.` heading and the line of context. The current **Confluence Cloud** editor has no markup insert and doesn't turn pasted wiki markup into a table, so use **Table** there.

If the browser doesn't allow the clipboard, the sheet says so; **Download** always works.

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
- [ ] **Tasks on the create form.** On the start page, **Review** shows 34 tasks grouped by team (8 each, and 2 Visual Regression tasks marked "UI/UX only"). Switch **Critical User Flows** off: 26 tasks, and back on: 34. Delete one (two presses), edit one, add one, then create the room. The room's task list matches what you left.
- [ ] **Tasks in the lobby.** With P in the room, M deletes or edits a task: P's list updates within a second, and P has no edit buttons. In P's console, `await sb.rpc("update_tasks", { p_room_id: snap.room.id, p_tasks: snap.room.tasks })` returns "Only the moderator can change the tasks." with hint `not_host`.
- [ ] **Device rule.** P joins with Mac and iOS on, nobody has Android. M spins: Mac and iOS tasks go to P (Mac rows show Safari), Android tasks are Unassigned with "No one online has an Android phone."
- [ ] **Everyone gets a task.** With several Desktop-only people (the moderator often is one), spin: everyone online has "You have 1 task" or more. Switch Critical User Flows off until there are more Desktop-only people than twice the Desktop tasks: the moderator sees "won't get 2 tasks … every task they can take already has 2 testers" under **Spin**.
- [ ] **Tasks lock at the first spin.** After the spin, the task panel is gone, and `update_tasks` from M's console returns hint `tasks_locked`.
- [ ] **Defaults stay default.** Open the start page again: it shows "34 tasks · default set", whatever you changed in earlier rooms.
- [ ] **UI/UX only.** Spin with P in AF and nobody in UI/UX: both Visual Regression tasks are Unassigned with "At the spin, no one from UI/UX online could take it.", and M's warning said so before the spin. Afterwards P presses **Assign me** on one: it works. With a UI/UX member online, the spin gives them one Visual Regression task, and no AF/CYD/PB member gets one from the spin. In the editor, the switch is on for these two; choosing All teams turns it off.
- [ ] **Joining late.** After the spin, a third profile L opens the invite link: the form says the wheel has already spun. L joins: the note above the table says "You joined after the spin…", **Assign me** on a task with a free place gives L the task, and the note goes away.
- [ ] **Reconnect re-fetches state.** In P's DevTools, set Network to *Offline*: the header shows "Reconnecting…". Meanwhile M complains or spins. Set P back to *Online*: the header returns to "Connected" and P shows the new state without replaying the reveal. While M is reconnecting, M's spin buttons are disabled.
- [ ] **Session links.** On the start page the two link rows start with `SESSION_LINK_1` and `SESSION_LINK_2`. Change one, clear the other, create the room: the bar shows only your link, for M and P, and it opens in a new tab. M presses **Edit links**, enters `ftp://x` (refused in the form), then a valid address and saves: P's bar updates. P has no **Edit links**.
- [ ] **Tasks per person.** The create form starts at 2. In the lobby P sees "Tasks per person 2"; M presses **−** and P sees 1. Put it back to 2 and spin with three people online: everyone has exactly 2 tasks, one of their own team's and one cross-team (Critical User Flows counts as cross-team), no task has more than 2 testers, and the tasks left over say "Everyone online who can take it already has 2 tasks." Before the spin, M's warning said how many would stay unassigned. In P's console, `await sb.rpc("update_settings", { p_room_id: snap.room.id, p_settings: { tasks_per_person: 1 } })` returns hint `not_host`; M gets `settings_locked` after the spin.
- [ ] **Moderator changes testers.** M presses **Change testers** on a task, checks P, unchecks the tester and saves: both browsers show P with "Added by the moderator", and P hears "The moderator gave you …". People without the task's device can't be checked. Unchecking everyone shows "Unassigned by the moderator."
- [ ] **Add, edit, delete after the spin.** M adds a task (a tester is suggested) and saves: it appears for everyone. M edits a phone task and adds Mac to its devices: testers without a Mac are unchecked with a note. M deletes the new task with two presses. A second spin (after two complaints) includes the added and edited tasks and not the deleted one.
- [ ] **Places.** On a task with two testers, P sees two Take over buttons, presses "Take over from …" on one: the request names that person, and only that person or M can approve it.
- [ ] **Take over.** After the spin, P presses **Take over** on one of M's Desktop tasks: P's row shows "Requested" with **Withdraw**, and both browsers show the request in the **Takeover requests** box within a second. M sees **Approve** and **Decline**; P sees neither. M approves: the task moves to P in both browsers, the row says "Took over from M", and P's "You have N tasks" goes up by one.
- [ ] **Decline is final, withdraw is not.** P asks for another of M's tasks; M presses **Decline** twice. P's row shows "Declined" with **Dismiss**, and in P's console `await sb.rpc("request_takeover", { p_room_id: snap.room.id, p_task_id: "<that task id>" })` returns hint `request_declined`. M's box still lists it greyed out with **Approve after all**; P presses **Dismiss** and it leaves M's box. P asks for a third task and withdraws: **Take over** comes back.
- [ ] **Only the holder or the moderator answers.** With a third profile, let P ask for one of the third person's tasks. In M's browser the request shows Approve and Decline; in P's own console `await sb.rpc("resolve_takeover", { p_request_id: "<id>", p_approve: true })`, with the id taken from `(await sb.rpc("get_room", { p_code: snap.room.code })).data.requests`, returns hint `not_allowed`. M asks for one of P's tasks: M's own item in the box has **Approve** and **Withdraw**.
- [ ] **Device rule on takeovers.** P (no Mac) has no **Take over** on Mac tasks. In P's console, `request_takeover` with a Mac task id returns hint `device_mismatch`.
- [ ] **Export.** After the spin, P presses **Export**: the sheet shows every task with its testers. **Copy table**, then paste into a Confluence page: it becomes a table with the same rows. Switch to **Wiki markup**, **Copy markup**, and in Confluence Data Center use Insert → Markup → Confluence wiki: same table. **Download** saves `wheeloftest-<code>-result.html` (or `.txt`). With **Show first spin** on, the export says "First spin (replaced)".
- [ ] **A spin clears pending requests.** With a request pending, get two complaints and let M spin again: the **Takeover requests** box disappears, and `(await sb.rpc("get_room", { p_code: snap.room.code })).data.requests` is empty. **Show first spin** has no buttons.

## Troubleshooting

- **Stuck on "Reconnecting…"**: check that `schema.sql` ran (it adds `rooms` to the `supabase_realtime` publication) and that Realtime **Allow public access** is on. The browser console logs the realtime error.
- **"The database functions are missing"**: run `supabase/schema.sql`.
- **"Anonymous sign-ins are disabled"**: see setup step 1.
