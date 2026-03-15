## kh protocol list

List blockchain protocols

```
kh protocol list [flags]
```

### Examples

```
  # List all protocols (cached)
  kh pr ls

  # Force refresh from API
  kh pr ls --refresh
```

### Options

```
  -h, --help      help for list
      --refresh   Bypass local cache and fetch fresh data
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

* [kh protocol](kh_protocol.md)	 - Browse blockchain protocols

