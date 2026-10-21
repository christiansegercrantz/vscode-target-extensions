# Target Extensions

Keep chosen VS Code extensions **off everywhere except in the workspaces, repositories and folders where you want them**. A Python repository gets the Python extensions, a Node one gets the Node extensions, and everything you never put in a category stays on as usual (git tools, themes, keymaps).

## How it works

- A **Category** is a named set of extensions (`python`, `node`, …). An extension in at least one category is *managed*: it is turned off for the whole profile and turned on only in the Targets that use one of its categories.
- A window's **Target** is the first of: the saved `.code-workspace` file, the git repository (identified by its `origin` URL, so re-clones and subfolders match), or the folder.
- A Target applies categories and can **override** single extensions (on or off). Rules saved under an earlier key still apply when a repository gains a remote or a folder becomes a repository, and move to the current key the next time they are saved.
- Extensions in no category are never touched. This extension never manages itself.
- Dependencies of an enabled extension are enabled with it.

Nothing is disabled until you **activate** it on a machine, by answering the first prompt. After that, opening an unconfigured Target asks which categories to use. Changes apply after **Reload Window**; the extension asks but never reloads on its own.

Empty windows and unsaved multi-root workspaces have no Target, so managed extensions stay off there.

## Settings (user settings, synced)

The settings are application-scoped, so VS Code stores them in the **Default** profile's `settings.json` and shares them with every profile. A non-default profile's own `settings.json` will not contain them; use **Open Config File** to jump to the right one.

```jsonc
"targetExtensions.categories": {
  "python": ["ms-python.python", "ms-python.vscode-pylance"],
  "node": ["dbaeumer.vscode-eslint", "esbenp.prettier-vscode"]
},
"targetExtensions.targets": {
  "repo:github.com/acme/api": {
    "categories": ["python"],
    "enable": [],
    "disable": ["ms-python.mypy-type-checker"]
  },
  "workspace:~/work/web.code-workspace": { "categories": ["*"] },   // * = every managed extension
  "folder:~/scratch/foo": { "categories": [] }                      // everything managed stays off
}
```

Use the commands (status bar item, or the Command Palette under *Target Extensions*) to edit these with pickers. To put one extension into categories, right-click it in the Extensions view and choose **Set Categories…**: tick the categories it belongs to, or add a new one. Unticking all of them stops managing it.

## Caveats

VS Code has no API for one extension to disable another. This extension writes VS Code's own enablement lists through an internal storage channel, so a VS Code update can break it (it then says so and does nothing). See `docs/adr/0001-global-disable-workspace-enable-via-internal-storage.md`. Installed extensions are listed per profile: the window's profile comes from VS Code's `storage.json` (an extension cannot ask for it), and a window with no recorded profile, such as an empty window, is treated as the Default profile. Remote windows (SSH, WSL, Dev Containers) are best-effort and untested.

Uninstalling runs a best-effort cleanup of the global disable entries; **Restore All Extensions** does it explicitly and also switches activation off.

## Development

The toolchain and tasks are managed with [mise](https://mise.jdx.dev): `mise install`, then:

| Task | |
|---|---|
| `mise run install` | install dependencies |
| `mise run check` | typecheck and unit tests |
| `mise run build` | bundle into `dist/` |
| `mise run test:integration` | real VS Code, throwaway profile, several relaunches |
| `mise run package` | build the `.vsix` |

Press F5 to debug. The vocabulary is in `GLOSSARY.md`.
