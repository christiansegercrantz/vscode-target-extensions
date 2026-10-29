# Inherit the nearest Parent Target's rules whole, rather than layering them

Folders inside a configured Folder, Repositories inside a configured Folder, and subfolders of a configured Repository should not each need their own rules. A Repository Subfolder, Repository or Folder with no entry of its own therefore uses the entry of its nearest enclosing Target that has one (its Parent Target), live, by looking keys up from the opened folder outward. When it has its own entry, that entry replaces the inherited one entirely; nothing is merged. This keeps "one entry decides a window" true, so the effective set is always readable from a single entry and the existing override logic (categories, then `enable`/`disable`) is unchanged.

## Considered Options

- **Layering**: a child starts from its parent's effective set and adds its own categories and overrides. More expressive, but every window's result depends on a chain of entries, and an override has to say which level it undoes.
- **Copy on first open**: the parent's entry is copied to the child. Simple to evaluate, but it bloats `targetExtensions.targets` and copies silently drift from the parent.

## Consequences

- Customizing starts from a copy of the parent's rules, so a small change does not mean re-choosing everything.
- Deleting a parent's entry makes its children fall through to the next configured ancestor, or become Unconfigured.
- A Repository Subfolder gets its own key, `repo:<repository key>#<path>`; `#` separates it from the repository because repository paths can be arbitrarily deep (GitLab subgroups).
- The Unconfigured prompt still saves a Repository Subfolder's first rules for the whole Repository; subfolder entries are only created deliberately, through Customize.
- There is no upper limit to the lookup, so `folder:~` works as a catch-all default; inheriting from it is not announced.
- Workspace Files have no Parent Target: they are chosen deliberately and may span several roots.
