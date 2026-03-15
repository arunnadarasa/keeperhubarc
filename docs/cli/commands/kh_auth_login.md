## kh auth login

Log in to KeeperHub

### Synopsis

Authenticate with KeeperHub. By default opens a browser for OAuth.
Use --no-browser for device code flow on headless or SSH environments.
Use --with-token to read an API key from stdin for non-interactive automation.

See also: kh auth status, kh auth logout

```
kh auth login [flags]
```

### Examples

```
  # Log in via browser
  kh auth login

  # Log in on a headless machine
  kh auth login --no-browser
```

### Options

```
  -h, --help         help for login
      --no-browser   Do not open a browser window
      --with-token   Read token from stdin
```

### Options inherited from parent commands

```
  -H, --host string   KeeperHub host (default: app.keeperhub.com)
      --jq string     Filter JSON output with a jq expression
      --json          Output as JSON
      --no-color      Disable color output
  -y, --yes           Skip confirmation prompts
```

### SEE ALSO

* [kh auth](kh_auth.md)	 - Authenticate with KeeperHub

