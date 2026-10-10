# Contributing

```bash
npm test               # node --test, no install needed
node scripts/site.mjs  # builds site/dist/ from synthetic sample data
```

Zero dependencies and Node 18 are the two constraints; CI runs the tests on Node 18,
20, 22 and 24.

## Prices

`src/pricing.mjs` carries list prices and `PRICES_AS_OF`. Re-verify every row against
the current pricing page before a release and move the date with it, even when nothing
changed.

## Releasing

Releases run from [`release.yml`](.github/workflows/release.yml) on a `v*` tag. It
publishes to npm over OIDC (Trusted Publishing — there is no npm token in this
repository), verifies the registry serves the version, cuts the GitHub release and
closes the milestone named `v<version>` when it has no open issues.

```bash
# bump package.json, then
npm test
git tag -a v0.2.0 -m "agent-ledger 0.2.0" && git push origin v0.2.0
```

**The first version is published by hand.** npm will not configure a trusted
publisher for a package that does not exist yet:

```bash
npm login
npm publish --access public
```

Then on npmjs.com → the package → Settings → Trusted Publisher → GitHub Actions:
organisation `Allan-Nava` (this case, exactly — npm compares it literally),
repository `agent-ledger`, workflow `release.yml`, environment empty. Push the
`v0.1.0` tag afterwards: the workflow skips the publish of a version already on the
registry and still cuts the release.

`release.yml` is part of that configuration — renaming it breaks publishing — and
`actions/setup-node` in it must not be given `registry-url`, or npm skips the OIDC
exchange and publishes with a placeholder token.
