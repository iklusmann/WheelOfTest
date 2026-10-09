# WheelOfTest

WheelOfTest is a colorful, static QA assignment roulette. It assigns unused QA tasks to connected testers, prefers same-team release work when possible, checks mobile-device availability, and supports one complaint-triggered replacement spin.

## Technology and repository layout

- HTML5 and CSS3
- Vanilla JavaScript ES modules
- Browser-native `RTCPeerConnection` and `RTCDataChannel`
- `localStorage` for host-side room state and guest-side profile convenience
- GitHub Pages for static hosting
- GitHub Actions for deployment

There is no build step, Node/npm runtime requirement, framework, external component or animation library, database, hosted backend, STUN/TURN server, public signaling service, or GitHub API token.

```text
WheelOfTest/
├── index.html
├── styles.css
├── app.js
├── logic.js
├── tests.html
├── tests.js
├── README.md
└── .github/
    └── workflows/
        └── deploy.yml
```

`logic.js` holds the task catalog and pure assignment/lifecycle rules separately from presentation and peer networking. `tests.html` is a standalone no-build test harness for those business rules.

## Run locally

Serve the folder from a local HTTP server so ES modules and WebRTC are available. A browser's `file://` restrictions may block ES module imports.

For example, use any static file server you already have, or VS Code's Live Server extension. Open the served `index.html`. The application itself does not require Node or npm.

You can also open `tests.html` on the same local static server to run the business-logic test suite in the browser. The harness does not test real network connectivity between different browsers.

## Deploy to GitHub Pages

1. Put the files in the root of a GitHub repository and commit them to `main`.
2. Push the commit to GitHub.
3. Open repository **Settings → Pages**.
4. Set the deployment source to **GitHub Actions**.
5. Wait for the **Deploy WheelOfTest to GitHub Pages** workflow to complete.
6. Open the published Pages URL, typically `https://USERNAME.github.io/REPOSITORY/`.

The workflow in `.github/workflows/deploy.yml` uploads the repository root directly. There is no build step. HTML, CSS and module paths are relative so repository-subpath hosting works.

## Create a room and invite testers

1. Open WheelOfTest and choose **Create a test room**.
2. The host browser creates a six-character room code and stores the room state in that browser's `localStorage`.
3. Copy the room link and share it with testers. The link contains a room identifier; it does **not** carry the shared room state.
4. In the host's room, choose **Create connection code**. This creates a WebRTC offer for one peer.
5. Send that offer code to one tester, separately from the room URL.
6. The tester opens the room URL, enters their name, phone availability and team, pastes the offer, and generates an answer code.
7. The tester sends the answer code back to the host. The host pastes it into the matching connection card and chooses **Accept answer & connect**.
8. When the data channel opens, the tester's profile is sent to the host and the room snapshot is synchronized.
9. Repeat the offer/answer exchange for each additional tester. Each developer needs their own peer connection.

The host can optionally add themselves to the tester pool from the participants panel. This local host profile does not need a peer connection.

Keep the host room open while the room is active. If either side refreshes or closes its page, the WebRTC connection is lost. The host must create a new offer and each affected tester must generate a new answer.

## How team-first assignment works

The candidate pool contains task/developer pairs, not just tasks or people. Only connected participants and unused tasks are considered. A mobile task requires `android === true` or `ios === true`; desktop tasks are available regardless of phone selections.

The assignment algorithm follows these steps:

1. Create every valid pair from unused tasks and connected participants.
2. Remove mobile pairs for participants who selected neither phone.
3. Find pairs where a task's preferred team matches the developer's selected team.
4. If any matching pairs exist, choose uniformly at random from those pairs; otherwise choose uniformly from all remaining valid pairs.

Consequently, the same-team preference is soft rather than an absolute rule. Critical User Flows tasks are team-neutral and cannot displace matching release pairs when those exist. Because selection is uniform across eligible *pairs*, tasks with more eligible developers have more possible pairs; this weighting is intentional and documented in `logic.js`.

The team mapping is defined in one place near the top of `logic.js`:

```js
export const TEAM_MAPPING = Object.freeze({
  "AF Release": "AF",
  "PB Release": "PB",
  "CD Release": "CYD"
});
```

The source task matrix calls the third release category `CD Release`, while the requested team is `CYD`; the default mapping above resolves that discrepancy and can be changed there.

## Spin lifecycle

- **Spin 1:** the host selects a valid pair before the animation starts. The provisional assignment and task usage are committed to host storage before animation, so a refresh cannot reset the spin count or make the same task available again.
- **Complaint:** a connected participant can complain once after Spin 1. The host validates and records the complaint, then broadcasts the updated room snapshot. The complaint does not automatically start another spin.
- **Spin 2:** only the host can start it, and only after a complaint. The first task stays unavailable, the first assignment is marked `challenged`, and the replacement becomes the final assignment. The room is completed after Spin 2.
- **No complaint:** the host can choose **Accept result & finish** to finalize Spin 1. This does not consume another spin.
- **No valid replacement:** Spin 2 remains disabled if no compatible unused task/developer pair exists. Device compatibility is never bypassed.
- **Completed room:** no additional spins or complaints are allowed. Create a new room to run a new assignment.

Assignment history keeps the first challenged assignment and the final replacement, including task details, developer/team details, selected devices, user roles and timestamps.

## Persistence and host authority

The host's room state, used task IDs, complaints, spin count and assignment history are stored in the host browser's `localStorage`. Guest browsers store only their own profile for convenience; they do not independently persist authoritative room state. The host is authoritative only while the host page is running and peer connections are active. This is not server-enforced security.

A host refresh restores the local room and history but marks remote participants disconnected. A completed room stays completed. A guest refresh restores the profile but not a live connection or a live snapshot; the guest must reconnect and receive a fresh snapshot from the host.

## Important architecture limitations

GitHub Pages is static hosting. Under the no-backend/no-signaling-service restriction, WheelOfTest cannot offer server-side shared room storage, room discovery, or automatic signaling. **A room URL and room code alone cannot create a shared multiplayer room.** The host's browser must remain open and each guest must exchange WebRTC offer/answer codes with the host.

The app uses `RTCPeerConnection` with an empty `iceServers` list, as requested. There is no STUN server to discover public network addresses and no TURN relay to carry traffic when direct connectivity fails. Direct WebRTC can work on compatible networks, but it is not guaranteed across NATs, VPNs, browser privacy restrictions, corporate firewalls or different networks. ICE gathering timing out, a peer connection failing, or a tester refreshing the page can require a fresh code exchange. No UI state is presented as live unless a peer connection actually opens and a host snapshot arrives.

Use HTTPS (GitHub Pages provides it) or localhost for reliable browser clipboard and WebRTC support. A room code is only an identifier, not a password or access-control mechanism. Do not use room codes as a security boundary or place confidential information in room profiles.

## Task catalog and device rules

The catalog preserves the 22 provided task IDs, themes, device/browser values, platform requirements and user roles. It includes four team-neutral Critical User Flows tasks and six release tasks for each release group. Team preference is configured separately from the stable task IDs.

Phone availability is represented by two independent booleans:

```js
{ android: true, ios: false }
```

Both, either, or neither are allowed. A tester with no phone can still receive a desktop task; any mobile task requires at least one selected phone.

## Business-logic tests

Open `tests.html` on a local static server or the deployed Pages site. The harness checks:

- All 22 task IDs are unique and team mapping is configured.
- Desktop/mobile eligibility for none, Android-only, iOS-only and dual-phone testers.
- Disconnected participants are excluded.
- Matching-team preference and cross-team fallback.
- Spin 1, complaint validation, duplicate complaint rejection, Spin 2 replacement and finalization.
- Acceptance of Spin 1 without consuming Spin 2.
- No spin when there are no eligible pairs.

These tests cover pure business logic only. They do not guarantee peer-to-peer connectivity on any particular network. The app intentionally avoids claiming that a network connection test passed unless an actual peer connection is established in the browser.
