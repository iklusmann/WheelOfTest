# WheelOfTest

WheelOfTest is a static, browser-based QA assignment tool for a small developer team. It draws a **task/developer pair**, prioritizes team matches, records complaints, and keeps a compact audit trail. It is intentionally local-first: there is no backend, cloud database, external signaling provider, or STUN/TURN service.

## What this implementation does

- Host-owned room lifecycle with a six-character room code and a role-specific invite URL.
- Manual WebRTC offer/answer exchange using one `RTCPeerConnection` and ordered `RTCDataChannel` per guest.
- Versioned host `localStorage` persistence, guest-local profile persistence, schema validation, normalization of old connection flags, and visible storage failures.
- Exactly 22 catalog tasks, team-first pair selection, mobile-device eligibility, Spin 1, one complaint per participant, Spin 2 replacement, explicit finalization, and immutable history snapshots.
- A premium dark charcoal / gold / silver / viridian UI with accessible focus states, keyboard-operable controls, responsive layouts, and reduced-motion support.
- A browser test harness that imports the pure business logic directly. No npm, build step, or third-party runtime dependency is needed.

## Important networking limitation

GitHub Pages only serves static files. A room URL or room code is a locator; it does **not** create shared room storage, signaling, or a live session.

The host and every guest must manually exchange a unique SDP offer/answer code. Connections use `new RTCPeerConnection({ iceServers: [] })`; this code intentionally has no STUN/TURN fallback. Direct host candidates can work on the same LAN or some permissive networks, but NAT, VPN, corporate firewalls, browser policies, and restrictive routers can prevent connection. Connectivity across arbitrary networks is not guaranteed. The UI never fabricates a connected participant, and guests do not show a snapshot as live until a current connection and host snapshot are received.

The host browser remains the only authority while it is open and connected. If the host closes the tab, refreshes, loses storage, or loses the peer connection, live collaboration ends. Persisted host state remains on that browser unless its local storage is cleared. This is an internal convenience tool, not an authorization or security boundary.

## Run locally (no build tools)

Use a local HTTP server because browser ES modules generally cannot be loaded from a `file://` URL.

```bash
cd WheelOfTest
python -m http.server 8000
```

Open [http://localhost:8000/](http://localhost:8000/) in a current browser. `localhost` is a secure context for browser features that require one. Keep the terminal/server open while using the app.

Open [http://localhost:8000/tests.html](http://localhost:8000/tests.html) to run the assertion harness. The tests import `domain.js`, `storage.js`, `tasks.js`, and signaling-code validation without starting the application UI or opening a peer connection. They report actual pass/fail results in the page.

## Host flow

1. Open WheelOfTest and select **Create a test room**. Existing saved rooms are retained; creating a new room does not delete them.
2. Optionally enable **I'll test too** and enter a name, team, and phone availability. Without that explicit profile, the host is not a tester and will not appear in the eligible tester pool.
3. Share the **Guest invite URL**. It includes `room` and `role=guest`; it is not a secret and is not proof of membership.
4. For each guest, select **Create connection code**. Each generated offer belongs to exactly one connection row and expires after 10 minutes.
5. Send that offer code to one intended guest using your normal out-of-band channel.
6. Paste the guest's returned answer into the **same row** and choose **Apply matching answer**. The profile becomes a registered live participant only after the data channel opens and its profile is accepted and persisted.
7. Review actual live participants and their teams/devices before selecting **Spin 1 · Draw assignment**.
8. If a connected, accepted participant files a complaint, the host may run **Spin 2 · Resolve**. Spin 2 chooses only unused tasks and replaces the original result while retaining the first result as challenged/void history.
9. If there are no complaints, the host can **Accept result · Finish room** without using Spin 2. If a complaint exists but no compatible replacement pair is available, the host may reconnect/add an eligible tester and retry; alternatively, the host can explicitly confirm acceptance of the original assignment. The UI warns that a complaint was filed.
10. A completed room never spins again. Create a new room for the next assignment.

## Guest flow

1. Open the invite URL. If you only have a room code, enter it on the landing page.
2. Enter your display name, select exactly one team (`AF`, `CYD`, or `PB`), and select Android and/or iOS availability. Neither phone is allowed; it means you can receive desktop tasks only.
3. Paste the **current host offer code** and select **Create answer code**.
4. Send the resulting answer code back to the host. Keep this browser tab open while the host applies it.
5. Once the data channel opens, the guest sends their profile. Wait for the first authoritative host snapshot before treating room details as current.
6. After Spin 1 and before completion, a connected participant may complain once. A complaint is a request only; it is recorded only after host validation. Guests cannot choose assignments or mutate host-owned room state.

Offer/answer codes can be large. Copy/paste the complete JSON code without adding surrounding text. Signaling codes are capped at 200 KiB and expire after 10 minutes. Data-channel messages are capped at 64 KiB. A room accepts up to 100 profiles to keep its complete snapshots within the message-size limit.

## Connection status and liveness

- **Creating offer / gathering ICE**: the browser is preparing a description and collecting local ICE candidates.
- **Waiting for answer**: send the offer to exactly one guest and paste that guest's answer into the matching row.
- **Channel open**: the data channel opened; this alone does not make a guest eligible until their profile is accepted.
- **Connected live**: the channel is open, a profile is accepted, and recent heartbeats are arriving.
- **Heartbeat stale / disconnected**: that peer is temporarily excluded from assignment selection. Some `disconnected` states recover; failed/closed channels need a new offer/answer exchange.
- **Guest offline/history view**: the guest must not interpret the last received snapshot as current. A fresh host snapshot is required to return to a live state.

Heartbeat cadence is 5 seconds; an 18-second freshness limit marks a peer stale. Offer/answer generation times out after 15 seconds if ICE gathering does not complete, and an unopened data channel reports a 30-second connection timeout. These are user-facing retry conditions, not a guarantee of connectivity.

## Assignment algorithm

For each spin, WheelOfTest:

1. Enumerates unused catalog tasks.
2. Considers only currently connected, profile-accepted participants (plus the explicit host-local tester if enabled and the host page is active).
3. Builds all `(task, developer)` pairs permitted by device compatibility.
4. Selects uniformly from same-team pairs if at least one exists. Mappings are `AF Release → AF`, `PB Release → PB`, and `CD Release → CYD`; `CD Release` remains the exact source task label. `Critical User Flows` tasks are neutral and do not displace available same-team pairs.
5. If there are no same-team pairs, selects uniformly from all valid pairs, including neutral and cross-team pairs.

Random selection is injected into `chooseEligiblePair` so tests can force exact indexes. Uniformity is over **pairs**, not people or tasks: a task that has more eligible developers contributes more pairs and therefore more chances to be drawn. This weighting is intentional and displayed as “valid pairs” in the dashboard.

## Phone compatibility

The catalog only distinguishes `desktop` and generic `mobile` platforms. Every desktop task is compatible regardless of phone selection. A mobile task requires at least one of Android or iOS. WheelOfTest does not infer OS-specific requirements from the device label and does not use the `users` metadata as an eligibility rule.

## Room state, storage and refresh behavior

- The host stores room state under a versioned, room-specific key in its browser `localStorage`. The stored object contains participants, spin count, assignments, used tasks, complaints, and a monotonically increasing `stateVersion`.
- The host persists every committed domain transition before installing it in memory, broadcasting a snapshot, or beginning the wheel reveal. If storage fails, the proposed state is rejected, the old committed state remains in memory, and state-changing controls are paused until the storage retry succeeds.
- Live data channels, RTC objects, heartbeat timestamps, and active connection flags are never durable room facts. Host refresh restores state/history but all remote guests begin disconnected. A previously saved `connected` flag is stripped during normalization and cannot establish eligibility.
- Guests persist only their own profile. They do not persist an independently authoritative room snapshot; on refresh, they must exchange fresh offer/answer codes and receive a new host snapshot.
- A host can resume a saved room through the host URL or the dashboard's saved-room card. The host must explicitly choose to create a new room; unfinished and completed rooms are not silently erased.
- Clearing browser storage removes that browser's saved rooms. There is no server-side backup or recovery.

## Spin and complaint rules

- **Spin 1** is available once in `waiting`, only to the host and only when a compatible live pair exists. The valid result is committed and stored before the decorative wheel animation starts.
- **Complaint** is accepted in `result` or `challenged`, before completion, from a connected accepted participant, at most once per participant per room. It does not automatically trigger a spin.
- **Spin 2** is host-only, requires at least one valid complaint and a replacement pair, excludes every used task (including Spin 1), and completes the room. The same developer may be selected again if still eligible.
- **Accept result** finalizes Spin 1 without consuming Spin 2 when there are no complaints.
- **Accept original anyway** is a warned exception after a complaint if no replacement pair is available. It finalizes the original assignment but keeps the complaint and challenge marker in the audit trail.
- Every accepted state transition increments `stateVersion` exactly once. A completed room rejects future spins and complaints.

## Design system

The CSS custom properties at the top of `styles.css` are the source of truth for the dark charcoal palette. Gold (`--gold`) is reserved for primary actions and result emphasis; silver (`--silver`) is neutral metadata; viridian (`--viridian`) indicates healthy connections and valid/positive states. Muted red is for failed/destructive actions and amber for warnings. Statuses are labelled in text as well as color. The UI uses system fonts, inline SVG/CSS details, visible keyboard focus, semantic controls and `prefers-reduced-motion` support.

## Security and privacy notes

- Room codes and signaling codes are not authentication. Share offer/answer codes only with intended participants.
- Browser-side validation is not server-enforced authorization. A peer can inspect data delivered to it, and browser identity can be reclaimed after a peer disconnects.
- Names and other user-supplied content are rendered as text nodes; user strings are not inserted using `innerHTML`.
- No analytics, cookies, external assets, API calls, external libraries or third-party signaling are used.
- Do not store confidential credentials or sensitive personal data in participant profiles.

## Manual integration checks

The unit harness cannot prove that two real networks can establish a WebRTC connection. Before relying on it with a team, test the scenarios below in current browsers:

1. **Same LAN:** start the host at the GitHub Pages HTTPS URL (or a local HTTP server), open a guest browser on the same network, exchange the offer/answer, confirm only after the data channel and profile are accepted.
2. **Different networks:** put the guest on a different ISP/mobile hotspot. Expect that the connection may fail because no STUN/TURN server is available.
3. **VPN / restrictive network:** test with the corporate VPN and typical firewall policies; record the exact browser/OS and failure diagnostics. Do not report this as supported unless observed in your environment.
4. **Reload and reconnect:** reload host and guest separately. Confirm host state/history survives, peers become disconnected, guests do not claim cached state is live, and fresh codes are required.
5. **Peer disconnect:** close one guest tab, wait for its liveness to expire, and verify that it is excluded from a spin. Reconnect it using a fresh connection.
6. **Storage failure:** use browser devtools to simulate blocked/quota-failing storage where possible; confirm state-changing actions pause and the previously committed result is not animated or broadcast as a new result.
7. **Responsive/keyboard:** check viewport widths 320 px, 390 px, tablet, and desktop; navigate forms and buttons with Tab/Enter/Space; enable reduced motion; inspect contrast and visible focus.

## GitHub Pages deployment

The included `.github/workflows/deploy.yml` deploys the repository root on pushes to `main` and supports manual runs through `workflow_dispatch`. It uses the official Pages actions and grants only `contents: read`, `pages: write`, and `id-token: write`.

1. Create a GitHub repository and push this project to the `main` branch.
2. In **Settings → Pages**, set the build/deployment source to **GitHub Actions**.
3. Ensure the workflow is enabled, then push to `main` or run **Actions → WheelOfTest · Deploy → Run workflow**.
4. Open the URL printed by the deployment job. Project sites use a path such as `https://USERNAME.github.io/REPOSITORY/`; all imports, styles and navigation use relative paths so that subpath works.
5. Visit `/tests.html` on the deployed site and run the browser harness.

### Deployment checklist

- [ ] Repository default branch is `main`.
- [ ] GitHub Pages source is **GitHub Actions**.
- [ ] The first workflow run completed successfully.
- [ ] The deployed URL loads `index.html` and relative ES module imports work.
- [ ] `/tests.html` runs tests without a build or npm install.
- [ ] The host/guest paths include `?room=CODE&role=host` and `?room=CODE&role=guest` respectively.
- [ ] Team members understand that offer/answer exchange is manual and cross-network connectivity is not guaranteed.
- [ ] Real WebRTC integration scenarios above have been exercised in the target environment.
