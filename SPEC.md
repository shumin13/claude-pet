# Claude Pet Spec

## Goal

Build a local desktop companion for Claude Code that behaves like Codex Pet: a lightweight, always-on-top desktop pet that reacts to Claude Code session lifecycle, permission prompts, idle states, and job completion without consuming extra model tokens.

The pet should appear on the user's laptop as a native desktop overlay, not just inside a browser tab.

## Non-Goals

- Do not call Claude or any model to power the pet.
- Do not consume extra tokens.
- Do not require a browser tab to stay open.
- Do not copy proprietary Codex Pet artwork/assets exactly unless legally available.
- Do not show noisy notifications for every hook event.
- Do not create multiple pet windows for multiple Claude sessions.

## Visual Direction Constraint

Keep the current robot character design as the base. Do not replace it with a completely different mascot, animal, pixel sprite, seed, plant, or new character.

The implementation should upgrade the existing robot by improving polish, animation, expressions, proportions, and interaction details while preserving its core identity:

- rounded robot head/body
- glowing antenna
- dark face screen
- soft blue/white shell
- small side arms/nubs
- compact feet
- speech bubble above the robot
- cute desktop companion feel

Allowed upgrades:

- smoother expressions
- better mouth/eye states
- cleaner antenna attachment
- improved hover animation
- better bubble/arrow polish
- improved close button placement
- subtle glow/shadow refinements
- better state transitions
- queue/count UI for multiple notifications

Not allowed:

- replacing the robot with a different character
- switching to a pixel-art pet
- making it look like an animal/seed/plant
- changing the core silhouette so much that it no longer reads as the same robot

## Performance and Memory Requirements

The pet should be lightweight enough to run continuously during Claude sessions without noticeably affecting laptop performance.

Requirements:

- Must not use Electron unless explicitly approved.
- Prefer native macOS overlay with WebKit, Swift/AppKit, or another lightweight native runtime.
- Local Node server should stay minimal and dependency-light.
- No model calls.
- No polling loops faster than necessary.
- Prefer event-driven updates through hooks and SSE/WebSocket-style local events.
- Avoid large animation libraries.
- Avoid large image/video assets.
- Avoid high-frequency canvas rendering unless needed.
- Animations should use CSS/SVG/native transforms where possible.
- Idle state should consume minimal CPU.
- Memory should remain stable over long sessions.
- Long-running sessions should not leak event listeners, SSE clients, timers, windows, or process handles.
- Soft target: keep the combined pet server and overlay under 150 MB resident memory during normal idle usage, and preferably much lower.

## Core Architecture

- Native macOS overlay window.
- Local Node server for event transport.
- Claude Code hooks send local events to the server.
- Desktop pet subscribes to server events.
- One pet window handles all Claude sessions.
- Events include session labels so users know which Claude session triggered the pet.
- Shared config file stores root path, port, endpoint URLs, build paths, PID paths, and session registry path.

## Main Components

- `server.js`: local event server.
- Native overlay app: transparent, frameless, always-on-top macOS window.
- `public/desktop.html`: desktop pet UI.
- `public/desktop.css`: desktop pet styling.
- `public/app.js`: event handling, state transitions, drag/close bridge.
- Hook scripts:
  - `SessionStart`: launch pet if needed and register active session.
  - `Notification`: show permission/idle notifications.
  - `PostToolUse`: clear permission notification after tool completes.
  - `Stop`: show job-done state.
  - `SessionEnd`: unregister session and close pet if no sessions remain.
- Shared config:
  - `lib/config.js`
  - `lib/session-labels.js`
- Tests:
  - integration test for server and hook behavior.

## Hook Behavior

### SessionStart

- Starts the local server if not running.
- Builds native overlay if needed.
- Launches desktop pet if not running.
- Registers the Claude session using `session_id`, `transcript_path`, or fallback id.
- Stores a readable session label, preferably the project folder name from `cwd`.
- Must not show a default notification bubble merely because a session started.

### Notification

- Displays useful Claude notifications.
- Prefixes message with a session label.
- Ignores noisy events:
  - `auth_success`
  - generic startup Bash permission messages such as `Claude needs your permission to use Bash`
- Marks displayed notification events as non-replayable.
- Should not replay stale notification events to newly connected overlays.

### PostToolUse

- Clears current permission notification.
- Returns pet to quiet ready state.
- Does not show a speech bubble.
- Used so permission prompts disappear after permission is granted and the tool finishes.

### Stop

- Shows a job-complete state.
- Displays session-labeled completion text.
- Uses a happy/success expression.
- Does not consume tokens.

### SessionEnd

- Removes the closed session from the active-session registry.
- If other sessions remain, keeps pet running.
- If no sessions remain, closes the overlay and stops the server.
- Prevents the pet from staying forever on the desktop after Claude is closed.

## Pet States

### ready

- Robot/pet is visible.
- Speech bubble hidden.
- Used after startup, cleared notifications, and idle baseline.
- Must not show default text on session start.

### permission_prompt

- Shows speech bubble.
- Message includes session label.
- Expression clearly indicates "asking for permission," not success or anger.
- Visual requirements:
  - amber/attention eyes
  - uncertain or asking mouth
  - alert badge
  - gentle asking tilt or subtle bounce
- Must clear after `PostToolUse`.

### idle_prompt

- Shows speech bubble only if Claude sends idle notification.
- Expression should look sleepy/waiting.
- Visual requirements:
  - sleepy eyes
  - flat or small mouth
  - slow idle animation

### job_done

- Shows speech bubble.
- Message includes session label.
- Expression clearly indicates success/completion.
- Visual requirements:
  - happy eyes
  - bigger smile
  - short success hop
- Must not be confused with permission state.

### offline/error

- Optional.
- If server disconnects, desktop UI may show subtle offline state or stay quiet.
- Must not spam the user.

## Desktop Window Requirements

- Native desktop window, not browser-only.
- Always-on-top or high floating level.
- Transparent background.
- Frameless.
- Small enough not to block work.
- Draggable.
- Manual close button appears on hover.
- Manual close must remove stale PID/lock files.
- If manually closed, next Claude session or relevant hook can relaunch it.
- Should appear on all Spaces where feasible.
- Should not steal focus aggressively.
- Close button should be visually anchored to the pet, not to an invisible bubble area.

## Notification Display Requirements

- One pet window only.
- One current speech bubble only.
- If multiple sessions send notifications, the newest event may replace the previous one in the basic implementation.
- If robust handling is desired, implement a queue:
  - current notification visible
  - queued count shown
  - next notification appears after current clears
  - permission notifications take priority over idle notifications
- Every displayed message should include a session label, for example:

```text
[api-server] Claude wants to run a command.
```

- Default/ready messages should not show on startup.
- Stale permission messages must not reappear after clearing, exiting, reconnecting, or refreshing.
- Non-replayable events must not be sent to new clients as the initial state.

## Notification Collapse and Queue Requirements

The pet should support a collapsed notification mode similar to Codex Pet.

Behavior:

- When one notification is active, show the normal speech bubble.
- When additional notifications arrive while one is active, queue them instead of overwriting them.
- If the user collapses the bubble, hide notification text and show a compact badge/count near the pet.
- The collapsed badge should show the number of pending notifications, for example `3`.
- Clicking the collapsed badge or pet should expand the current notification.
- Clearing the current notification should advance to the next queued notification.
- Permission prompts should be prioritized over idle and job-done events.
- Duplicate notifications from the same session and type within a short debounce window should collapse into one item.
- Collapsed mode must preserve session labels when expanded.
- Collapsed mode should not hide the fact that permission is needed.

## Resize Requirements

The desktop pet should support user-adjustable size.

Behavior:

- The pet should support at least three size presets: small, medium, and large.
- Default size should be small enough not to block work.
- Size setting should persist across launches.
- Resize control should be available from hover controls or a simple context menu.
- Resizing should scale the robot, speech bubble, close button, notification badge, and hit areas proportionally.
- Text must remain readable at all supported sizes.
- Dragging should still work after resizing.
- Resize should not create layout overlap or clipped speech bubbles.
- Implementation should avoid expensive rerendering or high-frequency layout work.

## Session Label Requirements

- Prefer project folder name from `cwd`.
- Fallback to transcript filename.
- Fallback to shortened `session_id`.
- Fallback to `Claude session`.
- Session labels must be added locally by hook scripts.
- No model call should be used to generate labels.

## Lifecycle Requirements

- Starting a Claude session starts the pet if needed.
- Opening multiple Claude sessions must not spawn multiple pets.
- Closing one Claude session must not close the pet if other sessions remain.
- Closing all Claude sessions closes the pet/server.
- Manual close hides the pet immediately.
- New session after manual close relaunches the pet.
- Server restart should not replay stale permission/job-done messages.

## Filtering Requirements

The pet must ignore:

```text
auth_success
Claude needs your permission to use Bash
```

The pet must display:

- meaningful permission prompts
- idle prompts
- job done / Stop events

## Build Requirements

- `npm start` runs local server.
- `npm run build:desktop` builds native macOS overlay.
- `npm run desktop` starts server and launches overlay.
- `npm test` runs integration tests.
- No npm dependencies required unless explicitly added.
- Swift build should output native binary to `.build/robot-pet-overlay`.

## Configuration Requirements

- Shared runtime paths must live in one config file.
- Port should be configurable with `CLAUDE_PET_PORT`.
- Endpoint should be configurable with `CLAUDE_PET_ENDPOINT`.
- README should use generic install paths such as:

```text
/path/to/claude-pet
```

- Claude settings must show full hook config examples.

## Static Preview Requirements

- The desktop pet preview HTML must render correctly when opened directly via `file://`.
- Static preview files must use relative asset paths for CSS and JS.
- Production desktop overlay should still use the local server for live hook events.
- Static visual preview files must remain usable without starting the server.

## Hover Requirements

- Hovering over the pet should reveal utility controls, including close.
- Hovering may trigger a subtle animation, such as looking up, blinking, antenna glow, or small bounce.
- Hover animation must not move the pet so much that it becomes hard to click or drag.

## Testing Requirements

Automated tests must cover:

- server health endpoint
- initial ready state
- `auth_success` ignored
- generic Bash permission ignored
- real permission prompt shown
- session label added
- notification marked non-replayable
- stale notification not replayed to new clients
- idle prompt rendered as `idle_prompt`
- stop hook sends `job_done`
- post-tool clear returns to `ready`
- JS syntax checks pass
- Swift overlay compiles
- no duplicated pet windows for multiple session starts
- manual close stale PID cleanup behavior
- session-end cleanup when final session closes

Manual/visual tests must cover:

- desktop overlay appears on laptop
- overlay is small enough
- overlay is draggable
- close button works
- manual close allows relaunch later
- permission expression distinct from success
- permission expression does not look angry
- success expression distinct from permission
- idle expression visible when triggered
- bubble arrow points down cleanly
- no default message on session start
- static `file://` preview renders correctly
- hover reveals close button near the pet
- hover animation, if implemented, feels subtle

## Acceptance Criteria

1. Starting a new Claude session launches exactly one desktop pet.
2. Starting multiple Claude sessions still shows only one desktop pet.
3. The pet does not show a default speech bubble on session start.
4. The pet displays a permission bubble when Claude sends a real permission prompt.
5. Permission prompt message includes the originating session label.
6. Permission state has a distinct asking/uncertain expression.
7. Permission bubble clears automatically after the approved tool finishes.
8. Generic startup Bash permission notifications are ignored.
9. Login/auth-success notifications are ignored.
10. Idle prompt renders when `idle_prompt` is received.
11. Idle state has a distinct sleepy/waiting expression.
12. Stop hook displays a job-done message.
13. Job-done message includes the originating session label.
14. Success/job-done state has a distinct happy expression.
15. Stale permission messages do not reappear after refresh, reconnect, clear, or exit.
16. Manual close button closes the desktop pet.
17. Manual close removes stale PID/lock state.
18. New Claude session relaunches the pet after manual close.
19. Closing one Claude session does not close the pet if other sessions remain.
20. Closing the final Claude session closes the pet and server.
21. The overlay is draggable.
22. The overlay stays above normal windows.
23. The overlay does not require a browser tab.
24. The overlay does not consume Claude tokens.
25. All hook scripts are local command hooks.
26. All paths used by scripts come from a central config module.
27. README uses generic install paths.
28. `npm test` passes.
29. Native Swift overlay compiles successfully.
30. Final zip includes source, hooks, scripts, tests, README, spec, and native overlay source.
31. If multiple notifications arrive close together, the pet must not lose them silently if queue mode is implemented.
32. Queue mode should show current notification and indicate queued notifications with a count.
33. Permission notifications should take priority over idle notifications.
34. Job-done notifications should not overwrite active permission prompts unless explicitly configured.
35. Duplicate notifications from the same session and same type within a short debounce window should be collapsed.
36. Hovering over the pet reveals utility controls.
37. Hovering over the pet may trigger a subtle animation.
38. Hover animation must not interfere with clicking or dragging.
39. The close button is anchored near the pet, not an invisible bubble area.
40. The desktop pet preview HTML renders correctly when opened directly via `file://`.
41. Static preview files load CSS and JavaScript with relative asset paths.
42. Production overlay still uses the local server for live hook events.
43. Ready state hides speech bubble.
44. Permission and success expressions are visually distinct.
45. Permission expression must not look angry.
46. The current robot design must be preserved as the base character.
47. Visual upgrades must improve polish without replacing the robot's core silhouette.
48. The robot must retain its rounded body, face screen, antenna, small side arms/nubs, and compact feet.
49. No redesign should turn the pet into a different mascot, pixel sprite, animal, seed, or plant.
50. Expressions and animations may be improved, but the robot must remain recognizable as the same character.
51. The desktop pet must avoid Electron unless explicitly approved.
52. The pet should use a lightweight native overlay/runtime.
53. The local server should have minimal dependencies.
54. Idle CPU usage should be negligible.
55. Memory usage should remain stable over long-running Claude sessions.
56. The implementation must not leak SSE clients, event listeners, timers, PID files, windows, or process handles.
57. Animations should use lightweight CSS/SVG/native transforms.
58. The implementation must avoid large image/video assets unless explicitly approved.
59. The pet must not noticeably slow down normal Claude Code usage.
60. Multiple Claude sessions must not multiply memory usage by spawning multiple pet windows.
61. The pet supports collapsed notification mode.
62. Collapsed mode hides the full speech bubble and shows a compact notification count.
63. The collapsed count reflects queued/pending notifications.
64. Clicking the collapsed badge or pet expands the current notification.
65. Multiple notifications are queued instead of silently overwritten.
66. Permission notifications remain visually urgent even when collapsed.
67. Clearing a notification advances to the next queued notification.
68. Duplicate notifications from the same session and type can be collapsed/debounced.
69. The pet supports user-resizable size presets.
70. Supported size presets include small, medium, and large.
71. The selected size persists across launches.
72. Resizing scales robot, bubble, controls, and notification badge proportionally.
73. Text remains readable at all supported sizes.
74. Dragging and close controls continue to work after resizing.
75. Resize behavior does not cause clipping, overlap, or excessive memory/CPU usage.
