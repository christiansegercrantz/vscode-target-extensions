# Target Extensions

Keep chosen VS Code extensions **off everywhere except in the workspaces, repositories and folders where you want them**. A Python repository gets the Python extensions, a Node one gets the Node extensions, and everything you never put in a category stays on as usual (git tools, themes, keymaps).

## How it works

- A **Category** is a named set of extensions (`python`, `node`, …). An extension in at least one category is *managed*: it is turned off for the whole profile and turned on only in the Targets that use one of its categories.
- A window's **Target** is the first of: the saved `.code-workspace` file, the git repository (identified by its `origin` URL, so re-clones match) or the subfolder of it that is open, or the folder.
- A Target applies categories and can **override** single extensions (on or off). Rules saved under an earlier key still apply when a repository gains a remote or a folder becomes a repository, and move to the current key the next time they are saved.
- A folder, repository or repository subfolder with no rules of its own **inherits** the rules of the nearest enclosing one that has some: a folder inside a configured folder, a repository inside a configured folder, or a subfolder of a configured repository. Inheritance is live, so editing the parent changes every folder that inherits from it. A notification says so when such a window opens (not after a reload this extension asked for, and not when the parent is your home folder, which makes `folder:~` a quiet catch-all). The status bar shows `· from <parent>`.
- **Customize** (in that notification, or when choosing categories or overrides) gives the folder its own rules, starting from the parent's. Its own rules replace the parent's entirely; they are not combined. **Use Parent's Rules** deletes them again, after confirming. A repository subfolder's own rules are saved under `repo:<origin>#<path>`.
- Extensions in no category are never touched. This extension never manages itself.
- Remote connection resolvers (SSH, WSL, Dev Containers, etc.) and their dependencies are never automatically disabled, even if they belong to a category or a Target disables them. They must be available before connecting to a remote Target. Earlier disable entries written by this tool are removed on the next evaluation; accept **Reload Window** to apply the repair. Manual disables are preserved.
- Dependencies of an enabled extension are enabled with it.

Nothing is disabled until you **activate** it on a machine, by answering the first prompt. After that, opening an unconfigured Target (one with no rules and nothing to inherit) asks which categories to use; for a repository subfolder the answer is saved for the whole repository. Changes apply after **Reload Window**; the extension asks but never reloads on its own.

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
  "repo:github.com/acme/api#docs": { "categories": [] },             // a subfolder opened on its own; replaces the repo's rules
  "workspace:~/work/web.code-workspace": { "categories": ["*"] },   // * = every managed extension
  "folder:~/scratch/foo": { "categories": [] }                      // everything managed stays off, here and in folders below
}
```

Use the commands (status bar item, or the Command Palette under *Target Extensions*) to edit these with pickers. To put one extension into categories, right-click it in the Extensions view and choose **Set Categories…**: tick the categories it belongs to, or add a new one. Unticking all of them stops managing it.

## Caveats

VS Code has no API for one extension to disable another. This extension writes VS Code's own enablement lists through an internal storage channel, so a VS Code update can break it (it then says so and does nothing). See `docs/adr/0001-global-disable-workspace-enable-via-internal-storage.md`. Installed extensions are listed per profile: the window's profile comes from VS Code's `storage.json` (an extension cannot ask for it), and a window with no recorded profile, such as an empty window, is treated as the Default profile. In remote windows (SSH, WSL, Dev Containers) the extension runs on the local machine, where the profile and enablement lists live; those lists also cover the remote's extensions. A remote repository is read through VS Code's file system API, so a clone with the same `origin` shares the local clone's Target, and other remote folders get keys such as `folder:ssh-remote+host/home/me/app`. Extensions installed only on the remote are invisible from the local machine and are not enabled. Remote support is otherwise best-effort.

Uninstalling runs a best-effort cleanup of the global disable entries; **Restore All Extensions** does it explicitly and also switches activation off.

When a Target refers to extensions that are not installed, one **Install** click installs them all. VS Code would otherwise ask about Settings Sync for each one, so they are installed as "do not sync". In a local window they are then switched back to synced through VS Code's internal *Sync This Extension* action. Settings Sync does not cover a remote's extensions, so a remote window (SSH, WSL, Dev Containers) skips that step and also offers **Pick from local…**, which opens VS Code's own picker for copying locally installed extensions to the remote. VS Code may still ask once per untrusted publisher.

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
