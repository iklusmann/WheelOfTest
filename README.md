# QA Roulette

A small, framework-free task assignment wheel built with:

- HTML
- CSS
- Vanilla JavaScript
- localStorage

## Run

Just open `index.html` in a modern browser.

No build step and no server are required.

## Behavior

- Developer enters their name.
- Developer can select Android, iOS, both, or neither.
- Mobile tasks require at least one selected phone.
- Desktop browser tasks do not require a phone.
- Assigned tasks are not eligible again during the current session.
- Assignment history is saved in localStorage.
- Refreshing the page keeps the developer and assignment state.
- Reset assignments makes all 22 tasks available again.

## Task source

The 22 task rows were entered from the screenshot supplied with the request.

Mobile rows are treated as `platform: "mobile"` and therefore require Android OR iOS.
