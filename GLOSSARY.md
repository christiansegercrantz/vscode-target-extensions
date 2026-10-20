# Per-Target Extension Enabling

A personal VS Code extension that keeps chosen extensions off everywhere except in the windows (Targets) where they are wanted.

## Language

### Targets

**Target**:
The thing a window is bound to for extension rules: a Workspace File if one is open, otherwise the Repository containing the folder, otherwise the Folder itself. Exactly one per window; no layering between levels.
_Avoid_: Scope, context, project

**Workspace File**:
A saved `.code-workspace` file opened in a window.
_Avoid_: Multi-root workspace (unsaved ones are not Targets)

**Repository**:
A git repository, identified by its normalized `origin` remote URL, or its root path when it has no remote.
_Avoid_: Repo path, clone

**Folder**:
A single opened directory that is not inside a Repository and not part of a Workspace File.

**Unconfigured Target**:
A Target with no entry in the configuration yet; opening one prompts the user to choose Categories or extensions.

**Unmanaged Window**:
A window with no Target: an empty window or an unsaved multi-root workspace.

### Extensions

**Category**:
A named set of extensions that are wanted together (e.g. "python", "node").
_Avoid_: Profile, group, preset

**Managed Extension**:
An extension that belongs to at least one Category. Off by default; on only in Targets that apply one of its Categories or explicitly enable it.

**Unmanaged Extension**:
An extension in no Category. Never touched by the tool, so always on unless the user disables it themselves.
_Avoid_: Global extension

**Override**:
A per-Target explicit enable or disable of a single extension that beats whatever the Target's Categories imply.

### Lifecycle

**Activation**:
The first user-confirmed Target choice on a given machine; before it, the tool disables nothing on that machine.
_Avoid_: Install, setup
