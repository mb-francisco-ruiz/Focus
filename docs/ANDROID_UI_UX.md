# Android UI/UX direction

## Product idea

Focus should feel like a quiet command centre for one person, not like a dense
project-management dashboard. The primary job of the home screen is to help the
user capture a thought quickly and understand what deserves attention next.

## Visual system

- **Ink** `#080D18`: low-glare background.
- **Deep slate** `#182235`: task and settings surfaces.
- **Focus blue** `#AFC6FF`: primary actions and selected navigation.
- **Signal mint** `#72E0C0`: online, synced, and completed states.
- **Attention amber** `#FFCB77`: due-soon and medium-priority information.
- **Soft red** `#FF8D8D`: destructive actions and high priority.

Headlines use the system serif face sparingly to give Focus a calm assistant
voice. Body copy uses the system sans-serif face, while compact status and
metadata use monospace so operational information is easy to distinguish.

## First iteration

- Rename the main views around user intent: Today, Tasks, Calendar, Inbox.
- Make natural-language capture the signature element on Today.
- Reserve the Tasks screen for scanning and managing work.
- Remove duplicated primary navigation from the top of the screen.
- Reduce visual competition between cards and improve title/metadata hierarchy.
- Animate screen changes and selection state without slowing interaction.
- Keep online state visible but quiet.

## Voice capture

Voice is implemented as a real capture mode rather than a decorative microphone.
The capture card moves through listening, transcribing, review, and error states
while preserving the existing text-based server contract. Android performs the
speech recognition and places partial/final results in the normal task field.
The user can edit the transcript before creating a task, recover from permission
or recognition errors, stop active recording, and always see whether the
microphone is listening.

## Compact actions and Ask Focus

The Today screen keeps task creation collapsed behind a small `New task`
button. `Ask Focus` opens a separate conversational surface for instructions
that may affect several tasks at once. It accepts text or voice, keeps recent
messages as correction context, refreshes the local task list after each reply,
and shows the assistant's confirmation inline.

The server assistant can search, create, update, complete and archive several
tasks in one instruction. Removal is implemented as recoverable archiving so a
follow-up such as “restore the task you removed” can undo a misunderstanding.
The model is instructed to confirm every action separately. Ask Focus requires
a Gemini API key, which can be stored from Android Settings; the server encrypts
the key at rest and never returns it to the client.
