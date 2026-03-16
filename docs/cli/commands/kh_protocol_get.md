## kh protocol get

Get a protocol

```
kh protocol get <protocol-slug> [flags]
```

### Examples

```
  # Get protocol reference card
  kh pr g uniswap

  # Get protocol details as JSON
  kh pr g aave --json
```

### Options

```
  -h, --help   help for get
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

