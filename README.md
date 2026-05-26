# Claude Pet

Claude Pet is a lightweight macOS desktop companion for Claude Code. It listens to local Claude Code hook events, renders a small always-on-top robot overlay, and shows session state without making any model calls.

The implementation is intentionally small:

- Native macOS overlay built with Swift, Cocoa, and WebKit
- Local Node.js event server bound to `127.0.0.1`
- No Electron runtime
- No runtime npm dependencies
- No telemetry
- No API keys, OAuth tokens, or credentials

## Animated Demo

<img src="https://raw.githubusercontent.com/shumin13/claude-pet/master/docs/assets/demo.gif" alt="Claude Pet demo showing ready, permission, idle, job done, one waiting notification, and multiple notifications" width="300">

The animated demo cycles through ready, permission, idle, job done, one waiting notification, and multiple project notifications.

Static reference images are available in `docs/assets/screenshots/`.

## Requirements

- macOS
- Node.js 18 or newer
- Claude Code with hook support

The npm package ships with a prebuilt macOS overlay. Xcode command line tools are only needed if you are building from source or the prebuilt overlay is missing.

## Install

Install globally with npm:

```sh
npm install -g @shumin13/claude-pet
```

Then run setup:

```sh
claude-pet
```

That command asks where to install Claude Pet's app files, checks requirements, installs the native macOS overlay, and installs the Claude Code hooks. The default app location is `~/Library/Application Support/claude-pet/app`, which keeps hook paths stable even if your global npm directory changes. After setup, open a new Claude Code session and the pet will launch automatically.

You can also pass the app location explicitly:

```sh
claude-pet --app-dir "$HOME/Applications/claude-pet"
```

Choose a dedicated Claude Pet folder. Setup refuses to copy app files into common directories like your home, Documents, Downloads, or Applications folder directly.

Launch it in the ready state:

```sh
claude-pet launch
```

Preview a notification without waiting for a real Claude Code hook:

```sh
claude-pet demo permission
```

Demo states are `permission`, `idle`, `done`, `one`, and `multi`.

Install or refresh only the Claude Code hooks:

```sh
claude-pet install-hooks
```

## Development

Run tests:

```sh
npm test
```

Build the local native overlay used by this checkout:

```sh
npm run build:overlay:local
```

Build the prebuilt overlay that ships in the npm package:

```sh
npm run build:overlay:package
```

Create a source archive for sharing:

```sh
npm run package:zip
```

`package:zip` is optional. It writes `.build/claude-pet-source.zip` and is useful for sending the project as a single archive. GitHub users can ignore it and push the source tree directly.

## Architecture

Claude Pet has three small runtime pieces:

| Layer          | Files                                                                           | Responsibility                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Event server   | `server.js`, `lib/`                                                             | Serves the UI, accepts local hook POSTs, streams events to the overlay with SSE, and filters noisy notifications.                      |
| Native overlay | `macos/RobotPetOverlay.swift`                                                   | Creates the transparent always-on-top macOS window, hosts the WebKit view, supports native dragging, and cleans up PID files on close. |
| Web UI         | `public/index.html`, `public/desktop.css`, `public/styles.css`, `public/app.js` | Renders the robot, notification bubbles, project grouping, collapsed badge, hover controls, preview controls, and resize behavior.     |

The lifecycle scripts keep the overlay singleton across multiple Claude Code sessions:

| Hook           | Script                                     | Behavior                                                                                                            |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `SessionStart` | `scripts/launch-desktop-if-needed.js`      | Starts the server and overlay if needed, records the active session, and avoids duplicate windows with a file lock. |
| `Notification` | `hooks/claude-pet-notify.js`               | Sends permission, idle, and other notifications to the local server with a project/session label.                   |
| `PermissionRequest` | `hooks/claude-pet-notify.js`         | Sends approval dialogs such as Bash permission requests to the local server as permission notifications.             |
| `PostToolUse`  | `hooks/claude-pet-clear.js`                | Clears permission prompts once a tool completes.                                                                    |
| `Stop`         | `hooks/claude-pet-stop.js`                 | Shows the job-done state for the current session.                                                                   |
| `SessionEnd`   | `scripts/close-desktop-if-last-session.js` | Removes the active session and shuts down the overlay/server after the final session exits.                         |

## Claude Code Hook Install

Install or refresh the hooks automatically:

```sh
claude-pet install-hooks
```

The installer updates `~/.claude/settings.json` and preserves a timestamped backup before writing.

Claude Code's hook events can change across versions. Claude Pet registers both
`Notification` and `PermissionRequest` because some Claude Code versions report
permission approval prompts as `permission_prompt` notifications, while newer
versions may fire `PermissionRequest` when the approval dialog appears. If
permission alerts stop appearing after a Claude Code update, run
`claude-pet install-hooks` to refresh the installed hook entries.

Manual hook configuration is also supported. Replace `/path/to/claude-pet` with the absolute path to this package:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/claude-pet/scripts/launch-desktop-if-needed.js"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/claude-pet/hooks/claude-pet-notify.js"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/claude-pet/hooks/claude-pet-notify.js"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/claude-pet/hooks/claude-pet-clear.js"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/claude-pet/hooks/claude-pet-stop.js"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/claude-pet/scripts/close-desktop-if-last-session.js"
          }
        ]
      }
    ]
  }
}
```

## Runtime Configuration

| Variable                 | Default                                            | Purpose                                                                                    |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `CLAUDE_PET_PORT`        | `37421`                                            | Local server port.                                                                         |
| `CLAUDE_PET_ENDPOINT`    | `http://127.0.0.1:${CLAUDE_PET_PORT}/events`       | Hook POST target.                                                                          |
| `CLAUDE_PET_APP_DIR`     | `~/Library/Application Support/claude-pet/app`     | Setup destination for stable app files and hook script paths.                              |
| `CLAUDE_PET_BUILD_DIR`   | `~/Library/Application Support/claude-pet`         | User-writable runtime directory for the native overlay, PID files, module cache, and logs. |
| `CLAUDE_PET_ROOT`        | Repository root                                    | Used by the native overlay for cleanup paths.                                              |
| `CLAUDE_PET_DESKTOP_URL` | `http://127.0.0.1:${CLAUDE_PET_PORT}/desktop.html` | Web UI URL loaded by the native overlay.                                                   |

The server binds to `127.0.0.1` only.

## UI Behavior

Claude Pet keeps one overlay window for all active Claude Code sessions. Multiple sessions do not create multiple pets.

Supported states:

- `ready`: quiet visible robot, no startup bubble, subtle blink
- `permission_prompt`: priority state with alert badge and permission bubble
- `idle_prompt`: waiting state with sleepy expression and blink
- `job_done`: completion state with smaller success smile
- multiple projects: one compact bubble per project
- collapsed notifications: compact count badge near the pet

Interaction behavior:

- Drag the pet body to move the native overlay
- Hover to reveal minimize, close, and resize controls
- Drag the lower-right resize handle for smooth manual resizing
- Click the collapsed badge or pet to expand notifications
- Empty transparent window space is click-through, so visible text or apps behind the pet remain clickable

UI layout requirements covered by tests:

- Minimize and close controls sit above the notification bubble when a bubble exists
- In ready/collapsed/multiple-project states, minimize and close stay near the pet and do not overlap the resize handle
- The resize handle appears only on hover, focus, or active resize
- The resize handle aligns to the pet base and shares the same right edge as the close control
- Resizing changes only the web UI scale and does not resize the native macOS window during drag

## Static Preview

The desktop UI can be opened directly for development:

```text
/path/to/claude-pet/public/index.html
```

Demo states can be rendered with query parameters when served through the local server:

```text
http://127.0.0.1:37421/desktop.html?demo=ready
http://127.0.0.1:37421/desktop.html?demo=permission
http://127.0.0.1:37421/desktop.html?demo=idle
http://127.0.0.1:37421/desktop.html?demo=done
http://127.0.0.1:37421/desktop.html?demo=one
http://127.0.0.1:37421/desktop.html?demo=multi
http://127.0.0.1:37421/desktop.html?demo=multi&collapsed=true
```

For an end-to-end local preview that starts the overlay and sends a fake event
through the same server path as Claude Code hooks, use:

```sh
claude-pet demo permission
```

## Privacy And Repository Safety

Claude Pet is local-only. It does not send prompts, transcripts, notifications, or usage data to a remote service.

The repository should not contain secrets. A push-readiness scan should only find documentation references to words such as "token" or "API key", not actual credentials.

Local/generated files are ignored:

- `.build/`
- `node_modules/`
- `.env*`
- log files
- `.DS_Store`
- coverage output
- local Claude settings such as `~/.claude/settings.json`

Recommended checks before publishing:

```sh
rg -n -i "(api[_-]?key|secret|token|password|passwd|authorization|bearer|private[_-]?key|BEGIN (RSA|OPENSSH|PRIVATE)|sk-[A-Za-z0-9]|xox[baprs]-|gh[pousr]_[A-Za-z0-9]|AIza[0-9A-Za-z_-]|AKIA[0-9A-Z]{16})" . -g '!node_modules/**' -g '!.build/**' -g '!*.zip'
npm test
npm run build:overlay:package
npm pack --dry-run
```

Publishing is automated from GitHub tags and published GitHub Releases. Add an `NPM_TOKEN`
repository secret with publish access, then create a version tag such as `v0.1.3`.
The workflow runs on macOS, installs dependencies, verifies the tag matches
`package.json`, runs npm's publish hooks, rebuilds the packaged Swift overlay,
and publishes to npm. Local `npm pack` and `npm publish` also rebuild the
packaged overlay automatically through the `prepack` script.

## Project Layout

```text
.
├── hooks/                Claude Code event hooks
├── lib/                  Shared config, runtime helpers, locks, session labels
├── macos/                Native Swift overlay
├── public/               Desktop UI
├── scripts/              Launch, shutdown, hook install, desktop runner
├── tests/                Integration tests
├── docs/assets/          README screenshots and demo media
├── server.js             Local event server
└── prebuilt/             Packaged macOS overlay binary
```
