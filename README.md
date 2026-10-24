# Xero Browser Automation

A Windows desktop app for recording what you do in a browser and replaying it as many times as you need, with realistic generated data in the form fields.

You browse a site normally while Xero writes down each click, keystroke, dropdown choice, upload and dialog answer. Afterwards it suggests a data type for every field it saw (email, first name, card number, ZIP code and 90 more). Replays can then use fresh, consistent fake data on every iteration. Runs go one at a time or in parallel, visible or in the background, at the speed you pick, on demand or on a schedule.

It uses the Microsoft Edge or Google Chrome already installed on the PC, so nothing else needs to be downloaded.

## Install

Run `release/Xero-Browser-Automation-Setup-1.0.0.exe`. The installer is per-user, lets you pick the folder and adds Start menu and desktop shortcuts. Windows SmartScreen may warn that the publisher is unknown because the installer is not code-signed. Choose **More info → Run anyway**.

## Using it

### Record

1. Paste a web address on the Home screen, or press **Ctrl N**, then **Start recording**. With no site in mind, use **Record the built-in practice form**.
2. A browser window opens with a small toolbar at the top of the page. Use the site as usual. Steps appear in Xero as you go.
3. The toolbar can also add steps that a click alone can't express:
   - **Check**: verify an element's text, that it is visible, a field's value, the page URL or the title. A run fails when a check fails.
   - **Save text**: store an element's text in a variable, such as an order number, for later steps.
   - **Hover**: for menus that open on mouse-over.
   - **Wait** and **Screenshot**.
4. Press **Stop** on the toolbar or in Xero.

File pickers open as a normal Windows dialog, and the chosen files become part of the step. Alerts, confirmations and prompts are answered, and the answer is replayed on every run.

### Generated data

When a recording stops, Xero shows every field it captured, the data type it detected, how confident it is and an example value. Untick anything that should stay fixed, change any type, then press **Apply**. You can open the same review later with **Generated data** above the steps.

Values in one iteration belong to one generated person, so first name, last name, email, username, phone and address all agree. A "Confirm password" field gets the same password as the "Password" field. Dropdowns pick one of their real options and skip placeholders like "Select…". Radio groups and checkboxes can be random too.

Each typing step can take its value from one of five sources:

| Source | Use it for |
|---|---|
| Fixed | The exact text you typed |
| Random | One of 97 data types, each with options (length, range, format, domain…) |
| Dataset | A column of a CSV or JSON table, one row per iteration |
| Variable | A value saved by an earlier step |
| Template | Mixed text, for example `{{persona.firstName \| lower}}+{{iteration}}@test.mycompany.com` |

Set **Settings → Generated data → Domain for generated emails** to a domain you control when the site sends real emails.

### Edit

- Drag steps to reorder them. Use **Alt ↑/↓**, **Ctrl D** to duplicate and **Ctrl C / Ctrl V** to copy steps, even into another flow. **Ctrl Z / Ctrl Y** undo and redo.
- Click a step to edit it on the right: the element it uses (with every fallback selector, **Pick again** to point at a different element, **Highlight** and **Test**), what it types, timeouts, retries, and whether it is optional.
- **Add step** offers two dozen step types, including *Wait for* (element, text, URL or network), *Check that*, *Save value*, *Set variable*, *Run JavaScript*, new and closed tabs, and drag and drop.
- **Play** runs the flow in the open browser. Click the dot left of a step number to set a breakpoint. Playback pauses there, and **Next step** goes one step at a time.
- **Record → Record after step N** replays the flow up to that step, then records new steps in place.

### Run

**Run…** opens the run settings:

- **Iterations** (1–100,000) and **Run in parallel** (up to 16 background browsers or 6 visible windows).
- **Speed** from 0.25× to Max, optional recorded pauses, key-by-key typing and human-like timing variation.
- **Dataset**, row order, **Start logged in** (a login saved from the live browser) and the country style of generated data.
- Retries per step, retrying failed iterations, stop on first failure, timeouts and screenshots.
- Advanced: page size, user agent, language, time zone, blocking images/fonts/video, proxies (rotated per iteration), and keeping or clearing cookies between iterations.

While a run is going you see each iteration as a cell on a strip, step-by-step results, a live view of background browsers, and the log. Finished runs keep a report. Export it as a single HTML file, the data that was typed as CSV (handy for a list of the test accounts it created), or everything as JSON.

When a site changes and an element no longer matches any of its selectors, Xero looks for the most similar element and can update the flow for you (**Update the flow when found**).

### Schedules

**Schedules → New schedule** runs a flow every N minutes or hours, daily, on chosen weekdays, once at a date and time, or on a cron expression. Schedules keep running while the window is closed to the tray. **Settings → General → Start with Windows** keeps them going after a restart.

### Other things worth knowing

- **Ctrl K** searches flows and runs and runs any action.
- **Flows → ⋯ → Export as Playwright test** produces a `@playwright/test` TypeScript file, with Faker calls for generated fields.
- **Test data → Generate data** builds a table of coherent fake people, accounts, addresses, card payments or companies. Save it as a dataset or export it as CSV.
- Brave, downloaded Chromium (**Settings → Browser → Download Chromium**) and any other Chromium-based browser also work.
- Everything is stored locally in `%APPDATA%\Xero Browser Automation\data` (**Settings → Storage → Open folder**). Saved logins contain cookies, so treat that folder like a password store.

## Development

Requires Node.js 22+ and Microsoft Edge or Chrome.

```bash
npm install
npx install-electron     # downloads the Electron binary (npm blocks install scripts by default)
npm run dev              # app with hot reload
npm run typecheck
npm test                 # unit checks + recording/replay engine test (headless Edge)
npm run test:ui          # drives the real app: record → generated data → play → breakpoints → run
npm run dist             # Windows installer in release/
```

| Path | What it is |
|---|---|
| `src/main` | Electron main process: window, tray, IPC, storage, scheduler |
| `src/main/live.ts` | The live browser: recording, picking, step-by-step playback |
| `src/main/engine` | Step executor, selector resolution and similarity healing |
| `src/main/runner.ts` | Batch runs with workers, retries, pause and stop |
| `src/injected` | Recorder injected into every page and frame: event capture, selector generation, toolbar |
| `src/shared` | Data model, 97 data generators, field-type detection, templates |
| `src/renderer` | React UI (Vite, Tailwind CSS 4, Radix primitives) |
| `resources/playground` | The built-in practice form |
| `tests`, `scripts/ui-e2e.mjs` | Engine, unit and UI end-to-end tests |
