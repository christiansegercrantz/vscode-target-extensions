# Per-Target Extension Enabling

A personal VS Code extension that keeps chosen extensions off everywhere except in the windows (Targets) where they are wanted.

## Language

### Targets

**Target**:
The thing a window is bound to for extension rules: a Workspace File if one is open, otherwise the Repository Subfolder or Repository containing the folder, otherwise the Folder itself. Exactly one per window. A Target's rules are never layered on top of another's: it uses either its own or, if it has none, its Parent Target's.
_Avoid_: Scope, context, project

**Workspace File**:
A saved `.code-workspace` file opened in a window.
_Avoid_: Multi-root workspace (unsaved ones are not Targets)

**Repository**:
A git repository, identified by its normalized `origin` remote URL, or its root path when it has no remote.
_Avoid_: Repo path, clone

**Repository Subfolder**:
A folder below a Repository's root, opened on its own. Identified by the Repository plus its path inside it (`repo:github.com/acme/api#packages/web`), so re-clones match.

**Folder**:
A single opened directory that is not inside a Repository and not part of a Workspace File.

**Parent Target**:
The nearest enclosing Repository Subfolder, Repository or Folder that has an entry in the configuration. Workspace Files have none.
_Avoid_: Ancestor, base

**Inherited Target**:
A Repository Subfolder, Repository or Folder with no entry of its own that uses its Parent Target's rules, live. Giving it its own entry (Customize) replaces the inherited rules entirely; deleting that entry makes it inherit again.

**Unconfigured Target**:
A Target with no entry in the configuration and no Parent Target; opening one prompts the user to choose Categories or extensions. For a Repository Subfolder, the answer is saved for the Repository.

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
