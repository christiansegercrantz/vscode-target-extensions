# Global disable + workspace enable, written via VS Code internal storage

VS Code exposes no public API or command to disable another extension (microsoft/vscode#15466 closed out-of-scope; #40239 still open). To make Managed Extensions off by default and on per Target without a relaunch, we disable them at profile (global) scope and add workspace-scope "enabled" entries per Target, writing VS Code's internal `extensionsIdentifiers/disabled` / `extensionsIdentifiers/enabled` storage keys directly. Global-off means a fresh window starts fast with Managed Extensions already off; the cost is reliance on unsupported internals and a reload whenever a window's effective set changes.

## Considered Options

- **Profiles**: supported and auto-associated with folders, but extensions cannot create or switch them, and each Category combination would need its own profile carrying its own settings and keybindings.
- **Relaunch with `code --disable-extension`**: supported flag, but not persisted, requires `code` on PATH, and does not work from Remote (SSH/WSL/Dev Containers) windows.
- **Workspace-scope disable only**: least invasive, but a new workspace has no entries, so every first open loads everything and then needs a reload to turn things off — the opposite of the desired fast first launch.

## Consequences

- All storage access sits behind one small interface so it can be replaced if #40239 ships a public API.
- A VS Code update may break the internal keys or write channel; this is acceptable for a personal tool.
- The tool records which global disable entries it added and only ever removes those (Restore all, removal from every Category, best-effort `vscode:uninstall` cleanup).
- Nothing is written globally before Activation on a machine, so installing the tool or receiving Categories via Settings Sync never disables anything by surprise.
- The tool never disables itself.
- Workspace storage is per opened folder, so each newly opened subfolder of an already-configured Repository needs one reload.
